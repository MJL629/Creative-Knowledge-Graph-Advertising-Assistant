import { callDeepSeekJson } from "./deepseek";
import type { BriefInput } from "./graph-pipeline";

type Category = "creative_element" | "motivation_conflict" | "story_event";
type GrowthMode = "deepen" | "next_event" | "add_conflict" | "add_element" | "twist" | "parallel";

export type GraphNodeSnapshot = {
  id: string;
  title: string;
  description: string;
  category: Category;
  subtype?: string;
  status: "candidate" | "adopted" | "excluded";
  parentId?: string;
  actorRefs?: string[];
  productFeatureRefs?: string[];
};

type GraphEdgeSnapshot = { source: string; target: string; label: string };

export type GrowthRequest = {
  brief: BriefInput;
  graphRevision: number;
  selectedNodeId: string;
  graph: { nodes: GraphNodeSnapshot[]; edges: GraphEdgeSnapshot[] };
  growthIntent: { mode: GrowthMode; targetCategory: Category; candidateCount: 2 | 3; instruction?: string };
  subjectContract: { promotionSubject: string; narrativeSubjectIds: string[]; productFeatureRefs: string[] };
};

export type GrowthCandidate = {
  clientKey: string;
  parentRef: string;
  category: Category;
  subtype?: string;
  title: string;
  description: string;
  attributes: Record<string, string | string[]>;
  rationale: string;
  actorRefs: string[];
  productFeatureRefs: string[];
  growthMode: GrowthMode;
  subjectContinuity: { status: "anchored" | "needs_subject"; score: number; note: string };
};

type GrowthContext = {
  selectedNode: GraphNodeSnapshot;
  ancestorPath: GraphNodeSnapshot[];
  acceptedNeighborhood: GraphNodeSnapshot[];
  excludedMemory: string[];
  narrativeSubjects: GraphNodeSnapshot[];
  expectedParentRef: string;
};

type CriticResult = {
  pass: boolean;
  issues: Array<{ clientKey: string; severity: "warning" | "error"; message: string; repair_instruction: string }>;
  summary: string;
};

const sharedSystem = `你是创意知识图谱短视频广告助手中的专业 Agent。你必须只输出 JSON，不能输出 Markdown。用户明确事实、Global Brief、主体契约和已采用节点优先。候选不能改写正式图谱事实，也不能生成数据库 ID、正式状态、版本或坐标。`;

function buildContext(input: GrowthRequest): GrowthContext {
  if (!input.brief?.product?.trim()) throw new Error("推广对象不能为空");
  if (!Number.isInteger(input.graphRevision) || input.graphRevision < 0) throw new Error("graphRevision 非法");
  if (![2, 3].includes(input.growthIntent?.candidateCount)) throw new Error("候选数量只能为 2 或 3");
  const categories: Category[] = ["creative_element", "motivation_conflict", "story_event"];
  if (!categories.includes(input.growthIntent?.targetCategory)) throw new Error("目标分类非法");

  const selectedNode = input.graph.nodes.find((node) => node.id === input.selectedNodeId);
  if (!selectedNode) throw new Error("选中的生长节点不存在");
  if (selectedNode.status === "excluded") throw new Error("已排除节点不能继续生长");

  const ancestorPath: GraphNodeSnapshot[] = [selectedNode];
  const visited = new Set([selectedNode.id]);
  let cursor = selectedNode;
  while (cursor.parentId) {
    if (visited.has(cursor.parentId)) throw new Error("检测到循环父子关系");
    const parent = input.graph.nodes.find((node) => node.id === cursor.parentId);
    if (!parent) throw new Error("祖先路径引用了不存在的节点");
    ancestorPath.unshift(parent);
    visited.add(parent.id);
    cursor = parent;
  }
  if (ancestorPath.length >= 4) throw new Error("当前分支已连续生长三层，请先收敛或返回上层节点");

  const narrativeSubjects = input.subjectContract.narrativeSubjectIds
    .map((id) => input.graph.nodes.find((node) => node.id === id))
    .filter((node): node is GraphNodeSnapshot => Boolean(node && node.status !== "excluded"));
  if (!narrativeSubjects.length && selectedNode.category === "creative_element") narrativeSubjects.push(selectedNode);

  const neighborIds = new Set<string>([selectedNode.id]);
  input.graph.edges.forEach((edge) => {
    if (edge.source === selectedNode.id) neighborIds.add(edge.target);
    if (edge.target === selectedNode.id) neighborIds.add(edge.source);
  });
  const acceptedNeighborhood = input.graph.nodes.filter((node) => node.status === "adopted" && (neighborIds.has(node.id) || narrativeSubjects.some((subject) => subject.id === node.id))).slice(0, 12);
  const excludedMemory = input.graph.nodes.filter((node) => node.status === "excluded").map((node) => node.title).slice(0, 20);
  const expectedParentRef = input.growthIntent.mode === "parallel" && selectedNode.parentId ? selectedNode.parentId : selectedNode.id;
  return { selectedNode, ancestorPath, acceptedNeighborhood, excludedMemory, narrativeSubjects, expectedParentRef };
}

async function supervisorAgent(input: GrowthRequest, context: GrowthContext, signal?: AbortSignal) {
  // Structured Decision（技术设计 4.1）：intent=grow 由端点确定，LLM 规划上下文与风险
  const result = await callDeepSeekJson<{ need_memory?: boolean; need_rag?: boolean; need_external_tool?: boolean; context_plan?: string[]; risk_flags?: string[] }>([
    { role: "system", content: `${sharedSystem}\n你是 Supervisor Agent。只规划本次局部生长上下文，不生成候选。intent=grow、next_agent=creative 已由路由层确定，你负责规划 context_plan、评估风险和判断是否需要 Memory/RAG/Tool。` },
    { role: "user", content: JSON.stringify({ task: "graph.grow.v2", brief: input.brief, growth_intent: input.growthIntent, subject_contract: input.subjectContract, selected_node: context.selectedNode, ancestor_path: context.ancestorPath, accepted_neighborhood: context.acceptedNeighborhood, excluded_memory: context.excludedMemory, output: { need_memory: "boolean", need_rag: "boolean", need_external_tool: "boolean", context_plan: ["string"], risk_flags: ["string"] } }) },
  ], signal);
  return {
    intent: "grow" as const,
    stage: "composition" as const,
    next_agent: "creative" as const,
    need_critic: true,
    need_memory: Boolean(result.need_memory),
    need_rag: Boolean(result.need_rag),
    need_external_tool: Boolean(result.need_external_tool),
    need_user_confirmation: false,
    context_plan: Array.isArray(result.context_plan) && result.context_plan.length ? result.context_plan.map(String) : ["Global Brief", "主体契约", "祖先路径", "已采用邻域", "排除记忆"],
    risk_flags: Array.isArray(result.risk_flags) ? result.risk_flags.map(String) : [],
  };
}

function normalizeCandidates(raw: GrowthCandidate[], input: GrowthRequest, context: GrowthContext): GrowthCandidate[] {
  return Array.isArray(raw) ? raw.map((candidate, index) => ({
    clientKey: String(candidate.clientKey || `grow_${index + 1}`),
    parentRef: String(candidate.parentRef || context.expectedParentRef),
    category: candidate.category,
    subtype: candidate.subtype ? String(candidate.subtype) : undefined,
    title: String(candidate.title || ""),
    description: String(candidate.description || ""),
    attributes: candidate.attributes && typeof candidate.attributes === "object" ? candidate.attributes : {},
    rationale: String(candidate.rationale || ""),
    actorRefs: Array.isArray(candidate.actorRefs) ? candidate.actorRefs.map(String) : [],
    productFeatureRefs: Array.isArray(candidate.productFeatureRefs) ? candidate.productFeatureRefs.map(String) : [],
    growthMode: input.growthIntent.mode,
    subjectContinuity: {
      status: candidate.subjectContinuity?.status === "anchored" ? "anchored" : "needs_subject",
      score: Math.max(0, Math.min(1, Number(candidate.subjectContinuity?.score || 0))),
      note: String(candidate.subjectContinuity?.note || ""),
    },
  })) : [];
}

async function creativeAgent(input: GrowthRequest, context: GrowthContext, plan: { context_plan: string[]; risk_flags: string[] }, repair: { nodes: GrowthCandidate[]; issues: CriticResult["issues"] } | null, signal?: AbortSignal) {
  const result = await callDeepSeekJson<{ nodes: GrowthCandidate[] }>([
    { role: "system", content: `${sharedSystem}\n你是 Creative Agent。只生成局部生长候选。新奇性不能通过更换主体获得；剧情事件必须有行动者，冲突必须围绕主体目标，创意元素必须说明如何支撑主体或产品。` },
    { role: "user", content: JSON.stringify({
      task: repair ? "repair_growth_candidates" : "generate_growth_candidates",
      brief: input.brief,
      growth_intent: input.growthIntent,
      subject_contract: input.subjectContract,
      context_plan: plan.context_plan,
      risk_flags: plan.risk_flags,
      selected_node: context.selectedNode,
      expected_parent_ref: context.expectedParentRef,
      ancestor_path: context.ancestorPath,
      accepted_neighborhood: context.acceptedNeighborhood,
      excluded_memory: context.excludedMemory,
      repair_input: repair,
      rules: [
        `只输出 ${input.growthIntent.candidateCount} 个 ${input.growthIntent.targetCategory} 候选`,
        "所有候选必须使用 expected_parent_ref",
        "不得复述已排除节点，不得改写已采用事实",
        "标题不超过 18 个汉字",
        "actorRefs 和 productFeatureRefs 只能引用输入中存在的值",
        "如果存在叙事主体，冲突与事件必须保留主体能动性",
      ],
      output: { nodes: [{ clientKey: "string", parentRef: "string", category: input.growthIntent.targetCategory, subtype: "string", title: "string", description: "string", attributes: {}, rationale: "string", actorRefs: ["existing node id"], productFeatureRefs: ["existing product feature"], subjectContinuity: { status: "anchored | needs_subject", score: "0-1", note: "string" } }] },
    }) },
  ], signal);
  return normalizeCandidates(result.nodes, input, context);
}

function validateCandidates(nodes: GrowthCandidate[], input: GrowthRequest, context: GrowthContext) {
  const errors: string[] = [];
  if (nodes.length !== input.growthIntent.candidateCount) errors.push(`候选必须正好为 ${input.growthIntent.candidateCount} 个`);
  const keys = new Set<string>();
  const graphIds = new Set(input.graph.nodes.map((node) => node.id));
  const features = new Set(input.subjectContract.productFeatureRefs);
  nodes.forEach((node, index) => {
    if (!node.clientKey || keys.has(node.clientKey)) errors.push(`第 ${index + 1} 个 clientKey 缺失或重复`);
    keys.add(node.clientKey);
    if (node.category !== input.growthIntent.targetCategory) errors.push(`第 ${index + 1} 个分类与目标不一致`);
    if (node.parentRef !== context.expectedParentRef) errors.push(`第 ${index + 1} 个父节点引用错误`);
    if (!node.title.trim() || node.title.length > 18) errors.push(`第 ${index + 1} 个标题为空或过长`);
    if (!node.description.trim()) errors.push(`第 ${index + 1} 个描述为空`);
    if (node.actorRefs.some((id) => !graphIds.has(id))) errors.push(`第 ${index + 1} 个主体引用不存在`);
    if (node.productFeatureRefs.some((feature) => !features.has(feature))) errors.push(`第 ${index + 1} 个产品卖点引用不存在`);
    if (context.narrativeSubjects.length && node.category !== "creative_element" && !node.actorRefs.length) errors.push(`第 ${index + 1} 个节点遗忘叙事主体`);
    if (features.size && !node.productFeatureRefs.length) errors.push(`第 ${index + 1} 个节点未关联产品卖点`);
  });
  return errors;
}

async function criticAgent(input: GrowthRequest, context: GrowthContext, nodes: GrowthCandidate[], signal?: AbortSignal): Promise<CriticResult> {
  const result = await callDeepSeekJson<Partial<CriticResult>>([
    { role: "system", content: `${sharedSystem}\n你是 Critic Agent。只审查主体漂移、广告目标遗忘、祖先路径矛盾、换词重复和隐性违反禁止内容。` },
    { role: "user", content: JSON.stringify({ review_mode: "growth_candidate", brief: input.brief, subject_contract: input.subjectContract, ancestor_path: context.ancestorPath, accepted_neighborhood: context.acceptedNeighborhood, excluded_memory: context.excludedMemory, candidates: nodes, output: { pass: "boolean", issues: [{ clientKey: "string", severity: "warning | error", message: "string", repair_instruction: "string" }], summary: "string" } }) },
  ], signal);
  const issues = Array.isArray(result.issues) ? result.issues.map((issue) => ({ clientKey: String(issue.clientKey || ""), severity: issue.severity === "warning" ? "warning" as const : "error" as const, message: String(issue.message || "语义审查未通过"), repair_instruction: String(issue.repair_instruction || "保持主体与推广目标后局部修复") })) : [];
  return { pass: result.pass === true && issues.every((issue) => issue.severity !== "error"), issues, summary: String(result.summary || "生长候选语义审查完成") };
}

async function storyAgent(input: GrowthRequest, context: GrowthContext, nodes: GrowthCandidate[], signal?: AbortSignal) {
  const result = await callDeepSeekJson<{ status?: string; score?: number; note?: string }>([
    { role: "system", content: `${sharedSystem}\n你是 Story Agent。只评估加入这些候选后是否继续保持主体、目标、阻碍、行动与产品价值，不生成故事。` },
    { role: "user", content: JSON.stringify({ task: "growth_readiness_only", brief: input.brief, accepted_graph: context.acceptedNeighborhood, growth_candidates: nodes, output: { status: "ready_hint | insufficient_graph", score: "0-100", note: "string" } }) },
  ], signal);
  return { status: result.status === "ready_hint" ? "ready_hint" : "insufficient_graph", score: Math.max(0, Math.min(100, Number(result.score || 0))), note: String(result.note || "等待用户采用候选") };
}

export async function runGrowthPipeline(input: GrowthRequest, signal?: AbortSignal) {
  const context = buildContext(input);
  const trace: Array<{ agent: "Supervisor" | "Creative" | "Critic" | "Story"; status: "passed" | "repaired" | "waiting"; summary: string }> = [];
  const plan = await supervisorAgent(input, context, signal);
  trace.push({ agent: "Supervisor", status: "passed", summary: `构造 ${plan.context_plan.length} 层生长上下文` });

  let nodes = await creativeAgent(input, context, plan, null, signal);
  let errors = validateCandidates(nodes, input, context);
  if (errors.length) throw new Error(`Growth Rule Validator 未通过：${errors.join("；")}`);
  trace.push({ agent: "Creative", status: "passed", summary: `生成 ${nodes.length} 个受控生长候选` });

  let critic = await criticAgent(input, context, nodes, signal);
  let repairs = 0;
  while (!critic.pass && repairs < 2) {
    nodes = await creativeAgent(input, context, plan, { nodes, issues: critic.issues }, signal);
    errors = validateCandidates(nodes, input, context);
    if (errors.length) throw new Error(`Growth Repair 校验未通过：${errors.join("；")}`);
    repairs += 1;
    critic = await criticAgent(input, context, nodes, signal);
  }
  trace.push({ agent: "Critic", status: repairs ? "repaired" : "passed", summary: critic.pass ? `主体一致性通过${repairs ? `，局部修复 ${repairs} 次` : ""}` : `达到修复上限：${critic.summary}` });

  const readiness = await storyAgent(input, context, nodes, signal);
  trace.push({ agent: "Story", status: "waiting", summary: `${readiness.status} · ${readiness.score} 分；采用后再更新正式图谱` });
  return { baseRevision: input.graphRevision, candidates: nodes, critic, readiness, trace, repairCount: repairs, context: { ancestorPath: context.ancestorPath.map((node) => node.id), acceptedNeighborhood: context.acceptedNeighborhood.map((node) => node.id), excludedMemory: context.excludedMemory, narrativeSubjectIds: context.narrativeSubjects.map((node) => node.id) } };
}
