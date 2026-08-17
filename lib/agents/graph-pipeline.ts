import { callDeepSeekJson } from "./deepseek";

export type BriefInput = {
  product: string;
  knownInformation?: string;
  ideaFragments: string[];
  mustKeep: string[];
  mustAvoid: string[];
  audience?: string;
  platform: string;
  durationSeconds: number;
  styles: string[];
  hotMemes?: string[];
  sellingPoints?: string[];
};

type Category = "creative_element" | "motivation_conflict" | "story_event";
type Candidate = {
  clientKey: string;
  category: Category;
  subtype?: string;
  title: string;
  description: string;
  attributes: Record<string, string | string[]>;
  rationale: string;
};

/**
 * Supervisor Structured Decision（技术设计 4.1）。
 * intent / next_agent 由 API 端点确定性决定；LLM 负责规划 context_plan、
 * risk_flags 和 need_* 判断。这样「任务类型」不会走样，上下文规划仍由模型动态完成。
 */
export type SupervisorIntent = "initial" | "grow" | "relation" | "converge" | "review" | "revise" | "retrieve";
export type SupervisorDecision = {
  intent: SupervisorIntent;
  stage: "exploration" | "composition" | "ready_to_converge" | "story_refinement";
  next_agent: "creative" | "critic" | "story";
  need_critic: boolean;
  need_memory: boolean;
  need_rag: boolean;
  need_external_tool: boolean;
  need_user_confirmation: boolean;
  context_plan: string[];
  risk_flags?: string[];
};

type CriticResult = {
  pass: boolean;
  issues: Array<{ clientKey: string; severity: "warning" | "error"; message: string; repair_instruction: string }>;
  summary: string;
};

type StoryReadiness = {
  status: "ready_hint" | "insufficient_graph";
  score: number;
  present_elements: string[];
  missing_elements: string[];
  note: string;
};

export type AgentTrace = {
  agent: "Supervisor" | "Creative" | "Critic" | "Story";
  status: "passed" | "repaired" | "waiting";
  summary: string;
};

const sharedSystem = `你是创意知识图谱短视频广告助手中的专业 Agent。你必须只输出 JSON，不能输出 Markdown。
用户明确事实和硬约束优先。不得把推测伪装成用户事实。不得生成数据库 ID、正式状态、版本、坐标或界面信息。`;

function normalizeList(values: string[]) {
  return values.map((v) => v.trim()).filter(Boolean);
}

function validateCandidates(nodes: Candidate[]) {
  const errors: string[] = [];
  const categories: Category[] = ["creative_element", "motivation_conflict", "story_event"];
  if (!Array.isArray(nodes) || nodes.length !== 6) errors.push("候选节点必须正好为 6 个");
  for (const category of categories) {
    if (nodes.filter((node) => node.category === category).length !== 2) errors.push(`${category} 必须正好 2 个`);
  }
  const keys = new Set<string>();
  nodes.forEach((node, index) => {
    if (!node.clientKey || keys.has(node.clientKey)) errors.push(`第 ${index + 1} 个 clientKey 缺失或重复`);
    keys.add(node.clientKey);
    if (!categories.includes(node.category)) errors.push(`第 ${index + 1} 个分类非法`);
    if (!node.title?.trim() || node.title.length > 18) errors.push(`第 ${index + 1} 个标题为空或过长`);
    if (!node.description?.trim()) errors.push(`第 ${index + 1} 个描述为空`);
    if (!node.attributes || typeof node.attributes !== "object") errors.push(`第 ${index + 1} 个 attributes 非法`);
  });
  return errors;
}

/**
 * 通用 Supervisor：接收确定性路由（intent/next_agent/stage），让 LLM 规划上下文与风险。
 * 路由原则（技术设计 4.5）：任务类型由端点决定，同一任务内部的链路不回 Supervisor。
 */
async function supervisorAgent(
  brief: BriefInput,
  route: { intent: SupervisorIntent; stage: SupervisorDecision["stage"]; next_agent: SupervisorDecision["next_agent"] },
  taskSummary: string,
  extraContext: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<SupervisorDecision> {
  const result = await callDeepSeekJson<Partial<SupervisorDecision>>([
    { role: "system", content: `${sharedSystem}\n你是 Supervisor Agent，只做任务理解、状态判断和上下文规划，不生成创意节点。intent、stage、next_agent 已由路由层确定，你负责规划 context_plan、评估风险和判断是否需要 Memory/RAG/Tool。` },
    { role: "user", content: JSON.stringify({
      task: taskSummary,
      brief,
      ...extraContext,
      fixed_route: { intent: route.intent, stage: route.stage, next_agent: route.next_agent, need_critic: true },
      required_output: { need_memory: "boolean", need_rag: "boolean", need_external_tool: "boolean", need_user_confirmation: "boolean", context_plan: ["string"], risk_flags: ["string"] },
    }) },
  ], signal);
  return {
    intent: route.intent,
    stage: route.stage,
    next_agent: route.next_agent,
    need_critic: true,
    need_memory: Boolean(result.need_memory),
    need_rag: Boolean(result.need_rag),
    need_external_tool: Boolean(result.need_external_tool),
    need_user_confirmation: Boolean(result.need_user_confirmation),
    context_plan: Array.isArray(result.context_plan) && result.context_plan.length ? result.context_plan.map(String) : ["Global Brief", "must_keep / must_avoid", "平台与时长"],
    risk_flags: Array.isArray(result.risk_flags) ? result.risk_flags.map(String) : [],
  };
}

async function creativeAgent(brief: BriefInput, decision: SupervisorDecision, repair?: { nodes: Candidate[]; issues: CriticResult["issues"] }, signal?: AbortSignal): Promise<Candidate[]> {
  const task = repair ? "局部修复候选" : "首轮发散";
  const prompt = {
    task,
    brief,
    context_plan: decision.context_plan,
    rules: [
      "只生成三个分类下的内容候选，每类正好 2 个，共 6 个",
      "创意元素应是人物、道具、场景、视觉符号或机制",
      "动机与冲突必须包含主体、阻碍和风险/失败后果",
      "剧情事件必须包含参与者、触发、行动和结果",
      "不得输出 source、分类入口、ID、状态、父节点、坐标",
      "标题不超过 18 个汉字，不得重复或换词复述 must_avoid",
    ],
    repair_input: repair || null,
    output: { nodes: [{ clientKey: "string", category: "creative_element | motivation_conflict | story_event", subtype: "string，可选", title: "string", description: "string", attributes: { key: "string 或 string[]" }, rationale: "string" }] },
  };
  const result = await callDeepSeekJson<{ nodes: Candidate[] }>([
    { role: "system", content: `${sharedSystem}\n你是 Creative Agent，负责扩大创意空间。Global Brief 必须始终保留；修复时只修改 Critic 指出的候选。` },
    { role: "user", content: JSON.stringify(prompt) },
  ], signal);
  return result.nodes;
}

async function criticAgent(brief: BriefInput, nodes: Candidate[], signal?: AbortSignal): Promise<CriticResult> {
  const result = await callDeepSeekJson<Partial<CriticResult> & { status?: string }>([
    { role: "system", content: `${sharedSystem}\n你是 Critic Agent，只做独立语义审查。不要重复字段、数量、ID 等确定性校验；重点检查偏题、隐性违反 must_avoid、语义重复、人物/冲突/事件矛盾和广告目标遗忘。` },
    { role: "user", content: JSON.stringify({ review_mode: "candidate", brief, candidates: nodes, output: { pass: "boolean", issues: [{ clientKey: "string", severity: "warning | error", message: "string", repair_instruction: "string" }], summary: "string" } }) },
  ], signal);
  const issues = Array.isArray(result.issues) ? result.issues.filter((issue) => issue && typeof issue.clientKey === "string").map((issue) => ({
      clientKey: String(issue.clientKey),
      severity: issue.severity === "warning" ? "warning" : "error",
      message: String(issue.message || "语义审查未通过"),
      repair_instruction: String(issue.repair_instruction || "根据 Brief 和约束修复该候选"),
    })) : [];
  const rawPass = String(result.pass ?? result.status ?? "").toLowerCase();
  const pass = result.pass === true || rawPass === "true" || rawPass === "pass" || (rawPass === "" && issues.every((issue) => issue.severity !== "error"));
  return {
    pass,
    issues,
    summary: String(result.summary || (result.pass ? "语义审查通过" : "语义审查未通过")),
  };
}

async function storyAgent(brief: BriefInput, nodes: Candidate[], signal?: AbortSignal): Promise<StoryReadiness> {
  const result = await callDeepSeekJson<Partial<StoryReadiness>>([
    { role: "system", content: `${sharedSystem}\n你是 Story Agent。当前只评估首轮候选图谱的可叙事准备度，不能生成故事，不能新增或改写核心人物、冲突、事件。由于候选尚未被用户采用，通常只能给 ready_hint 或 insufficient_graph。` },
    { role: "user", content: JSON.stringify({ task: "readiness_only", brief, candidate_graph: nodes, output: { status: "ready_hint | insufficient_graph", score: "0-100 number", present_elements: ["string"], missing_elements: ["string"], note: "string" } }) },
  ], signal);
  return {
    status: result.status === "ready_hint" ? "ready_hint" : "insufficient_graph",
    score: Math.max(0, Math.min(100, Number(result.score || 0))),
    present_elements: Array.isArray(result.present_elements) ? result.present_elements.map(String) : [],
    missing_elements: Array.isArray(result.missing_elements) ? result.missing_elements.map(String) : [],
    note: String(result.note || "等待用户采用候选节点后再进入剧情收敛"),
  };
}

export async function runInitialGraphPipeline(rawBrief: BriefInput, signal?: AbortSignal) {
  const brief: BriefInput = {
    ...rawBrief,
    product: rawBrief.product.trim(),
    knownInformation: rawBrief.knownInformation?.trim(),
    ideaFragments: normalizeList(rawBrief.ideaFragments),
    mustKeep: normalizeList(rawBrief.mustKeep),
    mustAvoid: normalizeList(rawBrief.mustAvoid),
    styles: normalizeList(rawBrief.styles),
    hotMemes: normalizeList(rawBrief.hotMemes || []),
    sellingPoints: normalizeList(rawBrief.sellingPoints || []),
  };
  if (!brief.product) throw new Error("推广对象不能为空");
  if (!brief.ideaFragments.length) throw new Error("至少需要一个碎片想法");

  const trace: AgentTrace[] = [];
  const decision = await supervisorAgent(brief, { intent: "initial", stage: "exploration", next_agent: "creative" }, "根据新 Brief 生成首轮创意知识图谱", {}, signal);
  trace.push({ agent: "Supervisor", status: "passed", summary: `intent=initial → ${decision.next_agent}；${decision.context_plan.join("、")}` });

  let nodes = await creativeAgent(brief, decision, undefined, signal);
  let ruleErrors = validateCandidates(nodes);
  if (ruleErrors.length) throw new Error(`Rule Validator 未通过：${ruleErrors.join("；")}`);
  trace.push({ agent: "Creative", status: "passed", summary: "生成三类各 2 个结构化候选" });

  let critic = await criticAgent(brief, nodes, signal);
  let repairs = 0;
  while (!critic.pass && repairs < 2) {
    nodes = await creativeAgent(brief, decision, { nodes, issues: critic.issues }, signal);
    ruleErrors = validateCandidates(nodes);
    if (ruleErrors.length) throw new Error(`Repair 后 Rule Validator 未通过：${ruleErrors.join("；")}`);
    repairs += 1;
    critic = await criticAgent(brief, nodes, signal);
  }
  trace.push({ agent: "Critic", status: repairs ? "repaired" : "passed", summary: critic.pass ? `语义审查通过${repairs ? `，局部修复 ${repairs} 次` : ""}` : `达到修复上限：${critic.summary}` });

  const readiness = await storyAgent(brief, nodes, signal);
  trace.push({ agent: "Story", status: "waiting", summary: `${readiness.status} · ${readiness.score} 分；等待用户采用后再收敛` });

  return { brief, decision, candidates: nodes, critic, readiness, trace, repairCount: repairs };
}

// ─── 关系推荐 pipeline（对应 PRD POST /api/graph/relations）──────────────────

export type RelationRequest = {
  brief: BriefInput;
  sourceId: string;
  targetId: string;
  source: { id: string; title: string; description: string; category: Category; subtype?: string; attributes?: Record<string, string | string[]> };
  target: { id: string; title: string; description: string; category: Category; subtype?: string; attributes?: Record<string, string | string[]> };
  existingRelations: string[];
  excludedRelations: string[];
};

export type RelationCandidate = {
  label: string;
  direction: "forward" | "reverse" | "both";
  rationale: string;
};

export async function runRelationPipeline(input: RelationRequest, signal?: AbortSignal) {
  if (!input.brief?.product?.trim()) throw new Error("推广对象不能为空");
  if (!input.sourceId || !input.targetId) throw new Error("关系端点不能为空");
  if (input.sourceId === input.targetId) throw new Error("关系端点不能相同");
  if (input.source.category === undefined || input.target.category === undefined) throw new Error("端点缺少分类信息");

  const trace: AgentTrace[] = [];
  const decision = await supervisorAgent(input.brief, { intent: "relation", stage: "composition", next_agent: "creative" }, "为两个内容节点生成语义关系候选", {
    source: input.source, target: input.target,
    existing_relations: input.existingRelations, excluded_relations: input.excludedRelations,
  }, signal);
  trace.push({ agent: "Supervisor", status: "passed", summary: `intent=relation → creative；${decision.context_plan.join("、")}` });

  const result = await callDeepSeekJson<{ relations: RelationCandidate[] }>([
    { role: "system", content: `${sharedSystem}\n你是 Creative Agent。只生成两个内容节点之间的语义关系候选，2～4 个，不写正式 relation_id、不决定正式状态。` },
    { role: "user", content: JSON.stringify({
      task: "relation_candidates",
      brief: input.brief,
      context_plan: decision.context_plan,
      risk_flags: decision.risk_flags,
      source: input.source,
      target: input.target,
      existing_relations: input.existingRelations,
      excluded_relations: input.excludedRelations,
      rules: [
        "输出 2～4 个关系候选",
        "每个候选包含 label、direction、rationale",
        "direction 只能是 forward | reverse | both",
        "label 不超过 12 个汉字",
        "不得复述已排除关系",
      ],
      output: { relations: [{ label: "string", direction: "forward | reverse | both", rationale: "string" }] },
    }) },
  ], signal);

  const relations = Array.isArray(result.relations) ? result.relations.map((r) => ({
    label: String(r.label || "").slice(0, 12),
    direction: r.direction === "reverse" ? "reverse" : r.direction === "both" ? "both" : "forward",
    rationale: String(r.rationale || ""),
  })).filter((r) => r.label) : [];

  if (!relations.length) throw new Error("未生成有效关系候选");
  trace.push({ agent: "Creative", status: "passed", summary: `生成 ${relations.length} 个关系候选（pending，等待用户确认）` });
  return { relations, decision, trace };
}

// ─── 剧情收敛 pipeline（对应 PRD POST /api/graph/concept）─────────────────────

export type StoryConceptRequest = {
  brief: BriefInput;
  adoptedNodes: Array<{ id: string; title: string; description: string; category: Category; subtype?: string; attributes?: Record<string, string | string[]> }>;
  adoptedEdges: Array<{ source: string; target: string; label: string; direction?: "forward" | "reverse" | "both" }>;
};

export type StoryConcept = {
  concept: string;
  theme: string;
  perspective: string;
  core_conflict: string;
  main_line: string;
  beats: Array<{ phase: string; text: string; refs: string[] }>;
  selling_point_insertion: string;
  twist: string;
  cta: string;
  shooting_feasibility: string;
};

export async function runStoryConvergePipeline(input: StoryConceptRequest, signal?: AbortSignal) {
  if (!input.brief?.product?.trim()) throw new Error("推广对象不能为空");
  if (!input.adoptedNodes?.length) throw new Error("至少需要采用一个节点才能收敛剧情");

  const trace: AgentTrace[] = [];
  const decision = await supervisorAgent(input.brief, { intent: "converge", stage: "ready_to_converge", next_agent: "story" }, "从已采用子图收敛短视频剧情", {
    adopted_nodes: input.adoptedNodes.map((n) => ({ id: n.id, title: n.title, category: n.category })),
    adopted_edges: input.adoptedEdges,
  }, signal);
  trace.push({ agent: "Supervisor", status: "passed", summary: `intent=converge → story；${decision.context_plan.join("、")}` });

  const result = await callDeepSeekJson<Partial<StoryConcept>>([
    { role: "system", content: `${sharedSystem}\n你是 Story Agent。只读取已采用节点和关系，收敛为约 ${input.brief.durationSeconds} 秒的短视频剧情。不能从未采用节点偷取创意，不能新增核心人物、冲突或事件。` },
    { role: "user", content: JSON.stringify({
      task: "story_converge",
      brief: input.brief,
      context_plan: decision.context_plan,
      adopted_nodes: input.adoptedNodes,
      adopted_edges: input.adoptedEdges,
      duration_seconds: input.brief.durationSeconds,
      rules: [
        "只使用 adopted_nodes 和 adopted_edges 中的事实",
        "beats 按 HOOK/发展/转折/高潮/CTA 组织，时间分配匹配 duration_seconds",
        "每个 beat 的 refs 只能引用 adopted_nodes 的 id",
        "selling_point_insertion 必须服务广告目标",
        "输出必须是合法 JSON",
      ],
      output: {
        concept: "string", theme: "string", perspective: "string",
        core_conflict: "string", main_line: "string",
        beats: [{ phase: "string", text: "string", refs: ["adopted node id"] }],
        selling_point_insertion: "string", twist: "string", cta: "string", shooting_feasibility: "string",
      },
    }) },
  ], signal);

  const concept: StoryConcept = {
    concept: String(result.concept || ""),
    theme: String(result.theme || ""),
    perspective: String(result.perspective || ""),
    core_conflict: String(result.core_conflict || ""),
    main_line: String(result.main_line || ""),
    beats: Array.isArray(result.beats) ? result.beats.map((b) => ({
      phase: String(b.phase || ""),
      text: String(b.text || ""),
      refs: Array.isArray(b.refs) ? b.refs.map(String) : [],
    })) : [],
    selling_point_insertion: String(result.selling_point_insertion || ""),
    twist: String(result.twist || ""),
    cta: String(result.cta || ""),
    shooting_feasibility: String(result.shooting_feasibility || ""),
  };

  // 引用校验（PRD 7.3：最终剧情引用 ID 必须来自已采用子图）
  const adoptedIds = new Set(input.adoptedNodes.map((n) => n.id));
  const invalidRefs = concept.beats.flatMap((b) => b.refs.filter((ref) => !adoptedIds.has(ref)));
  if (invalidRefs.length) throw new Error(`剧情引用了未采用节点：${[...new Set(invalidRefs)].slice(0, 3).join("、")}`);

  trace.push({ agent: "Story", status: "passed", summary: `生成 ${concept.beats.length} 节拍剧情 · 引用校验通过` });
  return { ...concept, decision, trace };
}
