"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Status = "candidate" | "adopted" | "excluded" | "needs_review";
type Category = "creative_element" | "motivation_conflict" | "story_event";
type Node = {
  id: string;
  title: string;
  description: string;
  category: Category;
  subtype?: string;
  status: Status;
  x: number;
  y: number;
  parentId?: string;
  provenance: string;
  attributes?: Record<string, string | string[]>;
  growthMode?: GrowthMode;
  actorRefs?: string[];
  productFeatureRefs?: string[];
  originalParentId?: string;
  originalDepth?: number;
  depth?: number;
  importance?: number;
};
type GrowthMode = "deepen" | "next_event" | "add_conflict" | "add_element" | "twist" | "parallel";
type Edge = { id: string; source: string; target: string; label: string; type: string; direction?: "forward" | "reverse" | "both"; status?: "pending" | "adopted" | "excluded" };
type AgentTrace = { agent: "Supervisor" | "Creative" | "Critic" | "Story"; status: "passed" | "repaired" | "waiting"; summary: string };
type StoryConcept = {
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
type RelationCandidate = { label: string; direction: "forward" | "reverse" | "both"; rationale: string };
type DivergenceCandidate = { category: Category; subtype?: string; title: string; description: string; attributes?: Record<string, string | string[]>; rationale: string };
type GrowthCandidate = { clientKey: string; parentRef: string; category: Category; subtype?: string; title: string; description: string; attributes: Record<string, string | string[]>; rationale: string; actorRefs: string[]; productFeatureRefs: string[]; growthMode: GrowthMode; subjectContinuity: { status: string; score: number; note: string } };
type ApiEnvelope<T> = { ok: boolean; result: T; error?: { code?: string; message?: string; details?: { snapshot?: GraphSnapshot } } };
type GraphSnapshot = { projectId: string; revision: number; nodes: ServerNode[]; edges: ServerEdge[] };
type ServerNode = Omit<Node, "x" | "y" | "provenance"> & {
  projectId: string;
  type: string;
  label: string;
  position?: { x: number; y: number };
  provenance?: string;
  createdAt: string;
  updatedAt: string;
};
type ServerEdge = Edge & { projectId: string; sourceId: string; targetId: string; createdAt: string; updatedAt: string };
type GraphOperation =
  | { type: "ADD_NODE"; node: Record<string, unknown> }
  | { type: "ADD_EDGE"; edge: Record<string, unknown> }
  | { type: "ADOPT_NODE" | "EXCLUDE_NODE" | "RESTORE_NODE"; nodeId: string }
  | { type: "UPDATE_NODE"; nodeId: string; patch: Record<string, unknown> }
  | { type: "DELETE_NODE"; nodeId: string; cascade?: boolean }
  | { type: "ADOPT_EDGE" | "EXCLUDE_EDGE" | "DELETE_EDGE"; edgeId: string };
type WorkflowState = {
  projectId: string;
  threadId: string;
  intent: "start" | "grow" | "relations" | "concept";
  graphRevision: number;
  focusNodeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  graphSnapshot?: GraphSnapshot;
  candidateResult?: unknown;
  next: string[];
  interrupts: unknown[];
  errors: string[];
};

async function readApiEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  return response.json() as Promise<ApiEnvelope<T>>;
}

function splitList(value: string) {
  return value.split(/[；;、,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function toUiGraph(snapshot: GraphSnapshot) {
  return {
    revision: snapshot.revision,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      title: node.title ?? node.label,
      description: node.description ?? "",
      category: (node.category ?? node.type) as Category,
      subtype: node.subtype,
      status: node.status,
      x: node.position?.x ?? 100,
      y: node.position?.y ?? 250,
      parentId: node.parentId ?? undefined,
      provenance: node.provenance ?? "Server persisted",
      attributes: node.attributes,
      growthMode: node.growthMode,
      actorRefs: node.actorRefs,
      productFeatureRefs: node.productFeatureRefs,
      originalParentId: node.originalParentId ?? undefined,
      originalDepth: node.originalDepth,
      depth: node.depth,
      importance: node.importance,
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId ?? edge.source,
      target: edge.targetId ?? edge.target,
      label: edge.label,
      type: edge.type ?? "semantic",
      direction: edge.direction,
      status: edge.status,
    })),
  };
}

function addNodeOperation(node: Node, status = node.status): GraphOperation {
  return {
    type: "ADD_NODE",
    node: {
      id: node.id,
      type: node.category,
      category: node.category,
      subtype: node.subtype,
      label: node.title,
      title: node.title,
      description: node.description,
      status,
      parentId: node.parentId,
      depth: node.depth,
      position: { x: node.x, y: node.y },
      attributes: node.attributes,
      provenance: node.provenance,
      growthMode: node.growthMode,
      actorRefs: node.actorRefs,
      productFeatureRefs: node.productFeatureRefs,
    },
  };
}

const categoryMeta: Record<Category, { label: string; color: string; x: number }> = {
  creative_element: { label: "创意元素", color: "#7657d5", x: 150 },
  motivation_conflict: { label: "动机与冲突", color: "#e8793f", x: 450 },
  story_event: { label: "剧情事件", color: "#29a38d", x: 750 },
};

const growthModes: Array<{ id: GrowthMode; label: string; hint: string; category?: Category }> = [
  { id: "deepen", label: "深化当前节点", hint: "补足细节，不改变核心含义" },
  { id: "next_event", label: "生成后续事件", hint: "让主体继续行动", category: "story_event" },
  { id: "add_conflict", label: "增加阻碍", hint: "围绕主体目标制造代价", category: "motivation_conflict" },
  { id: "add_element", label: "补充人物或道具", hint: "补齐行动所需元素", category: "creative_element" },
  { id: "twist", label: "生成反转", hint: "改变局势，但不更换主体", category: "story_event" },
  { id: "parallel", label: "创建平行方案", hint: "从同一父节点换一个方向" },
];

const initialNodes: Node[] = [
  { id: "character-01", title: "水枪国王", description: "戴透明王冠、用超长水枪发号施令的活动主角。", category: "creative_element", subtype: "人物", status: "candidate", x: 95, y: 255, provenance: "AI · brief + 创意方法库" },
  { id: "prop-01", title: "会逃跑的王冠", description: "漂在水面、主动躲避挑战者的胜负标志。", category: "creative_element", subtype: "道具", status: "candidate", x: 205, y: 405, provenance: "AI · 拟人化方法" },
  { id: "conflict-01", title: "十秒王位保卫战", description: "所有游客都能挑战现任国王，倒计时结束即换位。", category: "motivation_conflict", status: "candidate", x: 395, y: 255, provenance: "AI · 卖点约束" },
  { id: "conflict-02", title: "菜鸟被全场低估", description: "新手误拿拖把参战，却发现隐藏水炮。", category: "motivation_conflict", status: "candidate", x: 505, y: 405, provenance: "AI · 身份错位方法" },
  { id: "event-01", title: "全民挑战开启", description: "国王敲响权杖，全场设施瞬间变成对战机关。", category: "story_event", status: "candidate", x: 695, y: 255, provenance: "AI · 平台节奏约束" },
  { id: "event-02", title: "最后一秒换王", description: "新手用隐藏水炮反超，透明王冠飞向他。", category: "story_event", status: "candidate", x: 805, y: 405, provenance: "AI · 反转方法" },
];

function statusLabel(status: Status) {
  return { candidate: "待选择", adopted: "已采用", excluded: "已排除", needs_review: "需复核" }[status];
}

export default function Home() {
  const [stage, setStage] = useState<"brief" | "graph" | "output">("brief");
  const [product, setProduct] = useState("疯狂水世界");
  const [knownInformation, setKnownInformation] = useState("小程序多人休闲游戏。玩家在水上乐园使用水枪对战，轻松、魔性、适合朋友组队。");
  const [ideas, setIdeas] = useState(["一位国王把超长水枪当作权杖", "输掉挑战的人会被缩小，装进透明水球"]);
  const [mustKeep, setMustKeep] = useState("突出参与感；大型水枪对战");
  const [mustAvoid, setMustAvoid] = useState("危险动作；明星角色");
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [audience, setAudience] = useState("18～30岁休闲游戏用户");
  const [platform, setPlatform] = useState("douyin");
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [styles, setStyles] = useState("荒诞反转、网络感、节奏快");
  const [hotMemes, setHotMemes] = useState("不是哥们、王位争夺");
  const [sellingPoints, setSellingPoints] = useState("多人同屏、水枪对战、随时开局");
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [relationSource, setRelationSource] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [draftRelation, setDraftRelation] = useState({ label: "触发并推动", direction: "forward" as "forward" | "reverse" | "both" });
  const [pointer, setPointer] = useState({ x: 460, y: 325 });
  const [relationError, setRelationError] = useState("");
  const [growthOpen, setGrowthOpen] = useState(false);
  const [growthMode, setGrowthMode] = useState<GrowthMode>("deepen");
  const [growthCategory, setGrowthCategory] = useState<Category>("story_event");
  const [growthCount, setGrowthCount] = useState<2 | 3>(2);
  const [growthInstruction, setGrowthInstruction] = useState("");
  const [growthError, setGrowthError] = useState("");
  const [isGrowing, setIsGrowing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [workflowThreadId, setWorkflowThreadId] = useState<string | null>(null);
  const [pendingCandidateIds, setPendingCandidateIds] = useState<Set<string>>(new Set());
  const [request, setRequest] = useState("等待输入");
  const [traceId, setTraceId] = useState<string | null>(null);
  const [agentTrace, setAgentTrace] = useState<AgentTrace[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const hasRequiredIdea = ideas.some((value) => value.trim());

  // 节点编辑状态（FR-04）
  const [editingNode, setEditingNode] = useState(false);
  const [editDraft, setEditDraft] = useState({ title: "", description: "", subtype: "" });

  // 删除确认状态（FR-09）
  const [deleteConfirm, setDeleteConfirm] = useState<{ nodeId: string; nodeTitle: string; descendantCount: number } | null>(null);

  // 关系候选状态（FR-08，调 /api/graph/relations）
  const [relationCandidates, setRelationCandidates] = useState<RelationCandidate[]>([]);
  const [isLoadingRelations, setIsLoadingRelations] = useState(false);
  const [draftEdgeId, setDraftEdgeId] = useState<string | null>(null);

  // 剧情收敛状态（FR-10，调 /api/graph/concept）
  const [storyConcept, setStoryConcept] = useState<StoryConcept | null>(null);
  const [isConverging, setIsConverging] = useState(false);
  const [convergeError, setConvergeError] = useState("");

  // 节点拖拽（FR-03 自由布局基础版）
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const movedRef = useRef(false);

  // localStorage 只保存服务端项目指针；Project/Graph/Story 的唯一事实源是 API。
  const SESSION_KEY = "creative-graph-project-v2";
  const THREAD_KEY = "creative-graph-thread-v2";
  useEffect(() => {
    const savedProjectId = localStorage.getItem(SESSION_KEY);
    if (!savedProjectId) return;
    void (async () => {
      try {
        const [projectResponse, graphResponse, storyResponse] = await Promise.all([
          fetch(`/api/projects/${savedProjectId}`),
          fetch(`/api/projects/${savedProjectId}/graph`),
          fetch(`/api/projects/${savedProjectId}/stories`),
        ]);
        const projectPayload = await readApiEnvelope<{ name: string; brief: Record<string, unknown> }>(projectResponse);
        const graphPayload = await readApiEnvelope<GraphSnapshot>(graphResponse);
        const storyPayload = await readApiEnvelope<Array<{ content: StoryConcept }>>(storyResponse);
        if (!projectResponse.ok || !graphResponse.ok || !projectPayload.ok || !graphPayload.ok) throw new Error("项目不存在");
        const brief = projectPayload.result.brief;
        setProjectId(savedProjectId);
        setProduct(String(brief.product ?? ""));
        setKnownInformation(String(brief.knownInformation ?? ""));
        setIdeas(Array.isArray(brief.ideaFragments) ? brief.ideaFragments.map(String) : [""]);
        setMustKeep(Array.isArray(brief.mustKeep) ? brief.mustKeep.join("；") : "");
        setMustAvoid(Array.isArray(brief.mustAvoid) ? brief.mustAvoid.join("；") : "");
        setAudience(String(brief.audience ?? ""));
        setPlatform(String(brief.platform ?? "douyin"));
        setDurationSeconds(Number(brief.durationSeconds ?? 30));
        setStyles(Array.isArray(brief.styles) ? brief.styles.join("、") : "");
        setHotMemes(Array.isArray(brief.hotMemes) ? brief.hotMemes.join("、") : "");
        setSellingPoints(Array.isArray(brief.sellingPoints) ? brief.sellingPoints.join("、") : "");
        const graph = toUiGraph(graphPayload.result);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setRevision(graph.revision);
        const latestStory = storyPayload.ok ? storyPayload.result.at(-1)?.content : undefined;
        if (latestStory) setStoryConcept(latestStory);
        setStage(latestStory ? "output" : graph.nodes.length ? "graph" : "brief");
        setRequest("已从服务端恢复项目");
        const savedThreadId = localStorage.getItem(THREAD_KEY);
        if (savedThreadId) {
          const workflowResponse = await fetch(`/api/workflow/${savedThreadId}`);
          const workflowPayload = await readApiEnvelope<WorkflowState>(workflowResponse);
          if (workflowResponse.ok && workflowPayload.ok && workflowPayload.result.next.length) {
            setWorkflowThreadId(savedThreadId);
            const state = workflowPayload.result;
            if (state.intent === "start") {
              const result = state.candidateResult as { candidates?: DivergenceCandidate[] };
              const counters: Record<Category, number> = { creative_element: 0, motivation_conflict: 0, story_event: 0 };
              const restored = (result?.candidates ?? []).map((candidate, index): Node => {
                const slot = counters[candidate.category]++;
                return {
                  id: `pending_${savedThreadId}_${index}`,
                  title: candidate.title,
                  description: candidate.description,
                  category: candidate.category,
                  subtype: candidate.subtype,
                  status: "candidate",
                  x: categoryMeta[candidate.category].x + (slot ? 55 : -55),
                  y: 255 + slot * 150,
                  depth: 1,
                  attributes: candidate.attributes,
                  provenance: `Workflow restored · ${candidate.rationale}`,
                };
              });
              if (restored.length) {
                setNodes(restored);
                setPendingCandidateIds(new Set(restored.map((node) => node.id)));
              }
            } else if (state.intent === "grow") {
              const result = state.candidateResult as { candidates?: GrowthCandidate[] };
              const restored = (result?.candidates ?? []).map((candidate, index): Node => ({
                id: `pending_${savedThreadId}_${index}`,
                title: candidate.title,
                description: candidate.description,
                category: candidate.category,
                subtype: candidate.subtype,
                status: "candidate",
                x: categoryMeta[candidate.category].x + index * 50,
                y: 430 + index * 70,
                parentId: candidate.parentRef ?? state.focusNodeId,
                depth: 2,
                provenance: `Workflow restored · ${candidate.rationale}`,
                attributes: candidate.attributes,
                growthMode: candidate.growthMode,
                actorRefs: candidate.actorRefs,
                productFeatureRefs: candidate.productFeatureRefs,
              }));
              if (restored.length) {
                setNodes((current) => [...current, ...restored]);
                setPendingCandidateIds(new Set(restored.map((node) => node.id)));
              }
            } else if (state.intent === "relations" && state.sourceNodeId && state.targetNodeId) {
              const result = state.candidateResult as { relations?: RelationCandidate[] };
              const candidates = result?.relations ?? [];
              const edgeId = `pending_edge_${savedThreadId}`;
              setRelationCandidates(candidates);
              setDraftRelation({ label: candidates[0]?.label ?? "触发并推动", direction: candidates[0]?.direction ?? "forward" });
              setEdges((current) => [...current, { id: edgeId, source: state.sourceNodeId!, target: state.targetNodeId!, label: candidates[0]?.label ?? "触发并推动", type: "semantic", direction: candidates[0]?.direction ?? "forward", status: "pending" }]);
              setEditingEdgeId(edgeId);
              setDraftEdgeId(edgeId);
            }
            setRequest("已恢复暂停的 Workflow · 等待人工选择");
          }
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    })();
  }, []);

  useEffect(() => {
    function cancelRelation(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setRelationSource(null);
        setEditingEdgeId(null);
        setRelationError("");
      }
    }
    window.addEventListener("keydown", cancelRelation);
    return () => window.removeEventListener("keydown", cancelRelation);
  }, []);

  function updateIdea(index: number, value: string) {
    setIdeas((current) => current.map((ideaValue, ideaIndex) => ideaIndex === index ? value : ideaValue));
  }

  function addIdea() {
    setIdeas((current) => [...current, ""]);
  }

  function removeIdea(index: number) {
    setIdeas((current) => current.length === 1 ? current : current.filter((_, ideaIndex) => ideaIndex !== index));
  }

  const selected = nodes.find((node) => node.id === selectedId) || null;
  const adopted = nodes.filter((node) => node.status === "adopted");
  const narrativeAnchor = adopted.find((node) => node.category === "creative_element" && (node.subtype === "人物" || node.subtype === "角色")) || adopted.find((node) => node.category === "creative_element") || null;
  const adoptedIds = new Set(adopted.map((node) => node.id));
  // PRD 5.5：最终剧情只使用已采用节点和已采用关系（未确认 pending 关系不进入收敛）
  const adoptedEdges = edges.filter((edge) => edge.status === "adopted" && adoptedIds.has(edge.source) && adoptedIds.has(edge.target));

  const readiness = Math.min(100, adopted.length * 14 + adoptedEdges.length * 12 + (adopted.some((n) => n.category === "story_event") ? 18 : 0));

  const story = useMemo(() => {
    const names = adopted.map((node) => node.title);
    const sourceIds = adopted.map((node) => node.id);
    return [
      { phase: "HOOK · 0—3s", text: `${names[0] || "水枪国王"}举起超长水枪，十支水枪同时对准王冠。`, refs: sourceIds.slice(0, 2) },
      { phase: "发展 · 4—12s", text: "倒计时启动，全场设施化为水枪机关，游客集体加入王位争夺。", refs: sourceIds.filter((id) => id.includes("event") || id.includes("conflict")) },
      { phase: "转折 · 13—20s", text: `${names.find((n) => n.includes("菜鸟")) || "被低估的新手"}发现隐藏水炮，局势在最后三秒逆转。`, refs: sourceIds.slice(-2) },
      { phase: "高潮 · 21—27s", text: "透明王冠飞离旧王，产品玩法在决胜动作中自然完成展示。", refs: sourceIds },
      { phase: "CTA · 28—30s", text: `来${product}，下一任水世界国王可能就是你。`, refs: [] },
    ];
  }, [adopted, product]);

  function currentBrief() {
    return {
      product,
      knownInformation,
      ideaFragments: ideas.map((value) => value.trim()).filter(Boolean),
      mustKeep: splitList(mustKeep),
      mustAvoid: splitList(mustAvoid),
      audience,
      platform,
      durationSeconds,
      styles: splitList(styles),
      hotMemes: splitList(hotMemes),
      sellingPoints: splitList(sellingPoints),
    };
  }

  function applyServerGraph(snapshot: GraphSnapshot) {
    const graph = toUiGraph(snapshot);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setRevision(graph.revision);
  }

  async function ensureProject() {
    const brief = currentBrief();
    if (projectId) {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: product, brief }),
      });
      const payload = await readApiEnvelope<{ id: string }>(response);
      if (response.ok && payload.ok) return projectId;
      if (response.status !== 404) throw new Error(payload.error?.message || "项目更新失败");
    }
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: product, brief }),
    });
    const payload = await readApiEnvelope<{ id: string }>(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "项目创建失败");
    setProjectId(payload.result.id);
    localStorage.setItem(SESSION_KEY, payload.result.id);
    setRevision(0);
    return payload.result.id;
  }

  async function commitOperations(operations: GraphOperation[], targetProjectId = projectId) {
    if (!targetProjectId) throw new Error("请先创建项目");
    const response = await fetch("/api/graph/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: targetProjectId,
        expectedRevision: revision,
        operationId: await operationIdFor(revision, operations),
        operations,
      }),
    });
    const payload = await readApiEnvelope<GraphSnapshot>(response);
    if (!response.ok || !payload.ok) {
      if (response.status === 409 && payload.error?.details?.snapshot) applyServerGraph(payload.error.details.snapshot);
      throw new Error(payload.error?.message || "图谱提交失败");
    }
    applyServerGraph(payload.result);
    return payload.result;
  }

  async function operationIdFor(expectedRevision: number, operations: GraphOperation[]) {
    const bytes = new TextEncoder().encode(JSON.stringify({ projectId, expectedRevision, operations }));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function startWorkflow(input: Record<string, unknown>) {
    if (!projectId && !input.projectId) throw new Error("请先创建项目");
    const response = await fetch("/api/workflow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: input.projectId ?? projectId, ...input }),
    });
    const payload = await readApiEnvelope<WorkflowState>(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Workflow 启动失败");
    if (payload.result.next.length) {
      setWorkflowThreadId(payload.result.threadId);
      localStorage.setItem(THREAD_KEY, payload.result.threadId);
    } else {
      setWorkflowThreadId(null);
      localStorage.removeItem(THREAD_KEY);
    }
    return payload.result;
  }

  async function resumeWorkflow(operations: GraphOperation[]) {
    if (!workflowThreadId) throw new Error("没有可恢复的 Workflow");
    const response = await fetch("/api/workflow/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: workflowThreadId, decision: { action: "commit", operations } }),
    });
    const payload = await readApiEnvelope<WorkflowState>(response);
    if (!response.ok || !payload.ok) {
      if (response.status === 409 && payload.error?.details?.snapshot) applyServerGraph(payload.error.details.snapshot);
      throw new Error(payload.error?.message || "Workflow 恢复失败");
    }
    if (payload.result.graphSnapshot) applyServerGraph(payload.result.graphSnapshot);
    setWorkflowThreadId(null);
    setPendingCandidateIds(new Set());
    localStorage.removeItem(THREAD_KEY);
    return payload.result;
  }

  async function runInitialGeneration() {
    setIsGenerating(true);
    setGenerationError("");
    setAgentTrace([]);
    setRequest("四 Agent 编排运行中…");
    try {
      const activeProjectId = await ensureProject();
      const workflow = await startWorkflow({ projectId: activeProjectId, intent: "start", needRag: true });
      const result = workflow.candidateResult as { candidates: DivergenceCandidate[]; trace?: AgentTrace[]; repairCount: number };
      if (!result?.candidates?.length) throw new Error("Workflow 未返回候选");

      const positions: Record<Category, Array<{ x: number; y: number }>> = {
        creative_element: [{ x: 95, y: 255 }, { x: 205, y: 405 }],
        motivation_conflict: [{ x: 395, y: 255 }, { x: 505, y: 405 }],
        story_event: [{ x: 695, y: 255 }, { x: 805, y: 405 }],
      };
      const counters: Record<Category, number> = { creative_element: 0, motivation_conflict: 0, story_event: 0 };
      const generated: Node[] = result.candidates.map((candidate, index) => {
        const position = positions[candidate.category][counters[candidate.category]++] || { x: 100 + index * 80, y: 330 };
        return {
          id: `node_${crypto.randomUUID()}`,
          category: candidate.category,
          subtype: candidate.subtype,
          title: candidate.title,
          description: candidate.description,
          attributes: candidate.attributes || {},
          status: "candidate" as const,
          x: position.x,
          y: position.y,
          depth: 1,
          provenance: `DeepSeek · Creative Agent · ${candidate.rationale}`,
        };
      });
      setNodes(generated);
      setEdges([]);
      setPendingCandidateIds(new Set(generated.map((node) => node.id)));
      setAgentTrace(result.trace || []);
      setRequest(`Workflow 已暂停 · 请选择候选 · Repair ${result.repairCount} 次`);
      setStage("graph");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "生成失败");
      setRequest("生成失败 · 未写入图谱");
    } finally {
      setIsGenerating(false);
    }
  }

  async function updateStatus(id: string, status: Status) {
    if (pendingCandidateIds.has(id) && workflowThreadId) {
      try {
        const pendingNodes = nodes.filter((node) => pendingCandidateIds.has(node.id));
        await resumeWorkflow(pendingNodes.map((node) => addNodeOperation(node, node.id === id ? status : node.status)));
        setRequest(`Workflow 已恢复 · ${status} · Graph Commit 完成`);
      } catch (error) {
        setRequest(`Workflow 提交失败 · ${error instanceof Error ? error.message : "未知错误"}`);
      }
      return;
    }
    const operationType = status === "adopted" ? "ADOPT_NODE" : status === "excluded" ? "EXCLUDE_NODE" : "RESTORE_NODE";
    try {
      await commitOperations([{ type: operationType, nodeId: id }]);
      setRequest(`domain.update · ${status} · 已提交`);
    } catch (error) {
      setRequest(`提交失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  // 节点编辑（FR-04）+ 需复核传播（FR-12：编辑已采用内容后标记依赖）
  function startEditNode(node: Node) {
    setEditingNode(true);
    setEditDraft({ title: node.title, description: node.description, subtype: node.subtype || "" });
  }
  async function saveEditNode(id: string) {
    const target = nodes.find((n) => n.id === id);
    if (!target) return;
    const operations: GraphOperation[] = [{
      type: "UPDATE_NODE",
      nodeId: id,
      patch: {
        title: editDraft.title.trim() || target.title,
        label: editDraft.title.trim() || target.title,
        description: editDraft.description.trim() || target.description,
        subtype: editDraft.subtype.trim() || undefined,
        originalParentId: target.originalParentId || target.parentId,
        originalDepth: target.originalDepth ?? target.depth,
      },
    }];
    if (target?.status === "adopted") {
      // FR-12：编辑已采用节点 → 其语义关系邻居（已采用）标记为需复核
      const neighborIds = new Set<string>();
      edges.forEach((edge) => {
        if (edge.status !== "adopted") return;
        if (edge.source === id) neighborIds.add(edge.target);
        if (edge.target === id) neighborIds.add(edge.source);
      });
      nodes.filter((node) => neighborIds.has(node.id) && node.status === "adopted").forEach((node) => {
        operations.push({ type: "UPDATE_NODE", nodeId: node.id, patch: { status: "needs_review" } });
      });
    }
    try {
      await commitOperations(operations);
      setEditingNode(false);
      setRequest(`domain.update · 节点已编辑${operations.length > 1 ? ` · ${operations.length - 1} 个依赖节点需复核` : ""}`);
    } catch (error) {
      setRequest(`编辑提交失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  function cancelEditNode() { setEditingNode(false); }

  // 需复核 → 重新确认采用（PRD 5.2：用户重新确认后才进入最终剧情）
  async function confirmNeedsReview(id: string) {
    await updateStatus(id, "adopted");
  }

  // 重要性调整（PRD 7.1 importance 字段）
  async function updateImportance(id: string, level: number) {
    try {
      await commitOperations([{ type: "UPDATE_NODE", nodeId: id, patch: { importance: level } }]);
    } catch (error) {
      setRequest(`重要性提交失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  // 两种删除（FR-09）：仅删当前 / 级联删除
  function getDescendants(nodeId: string): Set<string> {
    const result = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift()!;
      nodes.filter((n) => n.parentId === current).forEach((child) => {
        if (!result.has(child.id)) { result.add(child.id); queue.push(child.id); }
      });
    }
    return result;
  }
  function openDeleteConfirm(node: Node) {
    const descendants = getDescendants(node.id);
    setDeleteConfirm({ nodeId: node.id, nodeTitle: node.title, descendantCount: descendants.size });
  }
  async function deleteNodeOnly(nodeId: string) {
    try {
      await commitOperations([{ type: "DELETE_NODE", nodeId, cascade: false }]);
      setSelectedId(null);
      setDeleteConfirm(null);
      setRequest("domain.delete · 仅删当前节点 · 已提交");
    } catch (error) {
      setRequest(`删除失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  async function deleteCascade(nodeId: string) {
    try {
      await commitOperations([{ type: "DELETE_NODE", nodeId, cascade: true }]);
      setSelectedId(null);
      setDeleteConfirm(null);
      setRequest("domain.delete · 级联删除 · 已提交");
    } catch (error) {
      setRequest(`删除失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  // 按层级自动整理（FR-03）：按生成深度分层排列，只重算坐标不改业务关系
  async function autoLayout() {
    const byDepth = new Map<number, Node[]>();
    nodes.forEach((node) => {
      const depth = node.depth || 1;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth)!.push(node);
    });
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    const positionMap = new Map<string, { x: number; y: number }>();
    depths.forEach((depth, layerIndex) => {
      const layerNodes = byDepth.get(depth)!;
      const span = layerNodes.length > 1 ? 760 / (layerNodes.length - 1) : 0;
      layerNodes.forEach((node, index) => {
        positionMap.set(node.id, {
          x: layerNodes.length > 1 ? 80 + index * span : 416,
          y: 225 + layerIndex * 132,
        });
      });
    });
    try {
      await commitOperations(nodes.map((node) => ({
        type: "UPDATE_NODE" as const,
        nodeId: node.id,
        patch: { position: positionMap.get(node.id) },
      })));
      setRequest("layout.auto · 按层级整理完成 · 已提交");
    } catch (error) {
      setRequest(`布局提交失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  async function finishDrag() {
    if (!dragState) return;
    const movedNode = nodes.find((node) => node.id === dragState.id);
    setDragState(null);
    setTimeout(() => { movedRef.current = false; }, 0);
    if (!movedNode) return;
    try {
      await commitOperations([{ type: "UPDATE_NODE", nodeId: movedNode.id, patch: { position: { x: movedNode.x, y: movedNode.y } } }]);
    } catch (error) {
      setRequest(`位置保存失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  function openGrowth(parent: Node) {
    setSelectedId(parent.id);
    setGrowthCategory(parent.category);
    setGrowthMode("deepen");
    setGrowthInstruction("");
    setGrowthError("");
    setGrowthOpen(true);
  }

  function ancestorPath(parent: Node) {
    const path: Node[] = [parent];
    let cursor = parent;
    while (cursor.parentId && path.length < 5) {
      const ancestor = nodes.find((node) => node.id === cursor.parentId);
      if (!ancestor) break;
      path.unshift(ancestor);
      cursor = ancestor;
    }
    return path;
  }

  function freePosition(category: Category, occupied: Node[]) {
    const xSlots: Record<Category, number[]> = {
      creative_element: [55, 165, 275],
      motivation_conflict: [330, 440, 550],
      story_event: [625, 735, 825],
    };
    const positions = [245, 370, 495].flatMap((y) => xSlots[category].map((x) => ({ x, y })));
    return positions.find((position) => occupied.every((node) => Math.hypot(node.x - position.x, node.y - position.y) > 96)) || positions[occupied.length % positions.length];
  }

  async function executeGrowth(parent: Node) {
    const path = ancestorPath(parent);
    if (path.length >= 4) {
      setGrowthError("当前分支已连续生长三层，请先采用、建立主体关系或返回上层节点。");
      return;
    }
    const modeMeta = growthModes.find((mode) => mode.id === growthMode);
    const category = modeMeta?.category || growthCategory;
    const anchor = narrativeAnchor || (parent.category === "creative_element" ? parent : null);
    const featureRefs = sellingPoints.split(/[，、；;\n]/).map((value) => value.trim()).filter(Boolean);
    setIsGrowing(true);
    setGrowthError("");
    setRequest(`graph.grow.v2 · ${modeMeta?.label} · 四 Agent 运行中`);
    try {
      void anchor;
      void featureRefs;
      const workflow = await startWorkflow({
        intent: "grow",
        focusNodeId: parent.id,
        needRag: true,
        growthMode,
        targetCategory: category,
        candidateCount: growthCount,
        growthInstruction: growthInstruction.trim(),
      });
      const result = workflow.candidateResult as { candidates: GrowthCandidate[]; trace?: AgentTrace[]; repairCount: number };
      if (!result?.candidates?.length) throw new Error("Workflow 未返回生长候选");
      const additions: Node[] = [];
      result.candidates.slice(0, growthCount).forEach((candidate) => {
        const position = freePosition(candidate.category, [...nodes, ...additions]);
        additions.push({
          id: `node_${crypto.randomUUID()}`,
          title: candidate.title,
          description: candidate.description,
          category: candidate.category,
          subtype: candidate.subtype,
          status: "candidate",
          x: position.x,
          y: position.y,
          parentId: candidate.parentRef,
          depth: (parent.depth || 1) + 1,
          provenance: `DeepSeek · graph.grow.v2 · ${candidate.rationale}`,
          growthMode: candidate.growthMode,
          actorRefs: candidate.actorRefs,
          productFeatureRefs: candidate.productFeatureRefs,
          attributes: { ...candidate.attributes, subjectContinuity: candidate.subjectContinuity.status, subjectScore: String(candidate.subjectContinuity.score), subjectNote: candidate.subjectContinuity.note },
        });
      });
      setNodes((current) => [...current, ...additions]);
      setPendingCandidateIds(new Set(additions.map((node) => node.id)));
      setAgentTrace(result.trace || []);
      setRequest(`Workflow 已暂停 · ${modeMeta?.label} · ${additions.length} 个候选 · Repair ${result.repairCount}`);
      setSelectedId(additions[0]?.id || parent.id);
      setGrowthOpen(false);
    } catch (error) {
      setGrowthError(error instanceof Error ? error.message : "生长候选生成失败");
      setRequest("graph.grow.v2 · 失败 · 未写入图谱");
    } finally {
      setIsGrowing(false);
    }
  }

  function nodeClick(node: Node) {
    if (relationSource && relationSource !== node.id) {
      // 选了目标节点，调 /api/graph/relations 获取 AI 关系候选（FR-08）
      setSelectedId(node.id);
      loadRelationCandidates(relationSource, node.id);
      return;
    }
    setSelectedId(node.id);
  }

  async function loadRelationCandidates(sourceId: string, targetId: string) {
    setIsLoadingRelations(true);
    setRelationError("");
    setRelationCandidates([]);
    try {
      const sourceNode = nodes.find((n) => n.id === sourceId);
      const targetNode = nodes.find((n) => n.id === targetId);
      if (!sourceNode || !targetNode) throw new Error("端点节点不存在");
      const workflow = await startWorkflow({ intent: "relations", sourceNodeId: sourceId, targetNodeId: targetId, needRag: false });
      const result = workflow.candidateResult as { relations?: RelationCandidate[] };
      const candidates: RelationCandidate[] = result?.relations || [];
      setRelationCandidates(candidates);
      if (candidates.length) setDraftRelation({ label: candidates[0].label, direction: candidates[0].direction });
      // 先创建一条 pending 边，等用户确认
      const id = `edge-${Date.now()}`;
      setEdges((current) => [...current, { id, source: sourceId, target: targetId, label: candidates[0]?.label || "触发并推动", type: "causes", direction: candidates[0]?.direction || "forward", status: "pending" }]);
      setEditingEdgeId(id);
      setDraftEdgeId(id);
    } catch (error) {
      // 降级：允许用户手动输入
      const id = `edge-${Date.now()}`;
      setEdges((current) => [...current, { id, source: sourceId, target: targetId, label: "触发并推动", type: "causes", direction: "forward", status: "pending" }]);
      setEditingEdgeId(id);
      setDraftEdgeId(id);
      setDraftRelation({ label: "触发并推动", direction: "forward" });
      setRelationError(error instanceof Error ? `AI 推荐 failed（可手动输入）：${error.message}` : "AI 推荐 failed，可手动输入");
    } finally {
      setIsLoadingRelations(false);
    }
  }

  function startRelation(node: Node) {
    setRelationSource(node.id);
    setEditingEdgeId(null);
    setRelationError("");
    setRelationCandidates([]);
    setDraftEdgeId(null);
    setSelectedId(node.id);
  }

  async function saveRelation() {
    if (!editingEdgeId || !draftRelation.label.trim()) {
      setRelationError("请选择或输入关系");
      return;
    }
    const edge = edges.find((item) => item.id === editingEdgeId);
    if (!edge) return;
    try {
      const operations: GraphOperation[] = [{ type: "ADD_EDGE", edge: {
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        source: edge.source,
        target: edge.target,
        label: draftRelation.label.trim(),
        type: edge.type,
        direction: draftRelation.direction,
        status: "adopted",
      } }];
      if (workflowThreadId) await resumeWorkflow(operations);
      else await commitOperations(operations);
      setRequest("Workflow relation · 用户确认 · 已提交");
    } catch (error) {
      setRelationError(error instanceof Error ? error.message : "关系提交失败");
      return;
    }
    setRelationSource(null);
    setEditingEdgeId(null);
    setDraftEdgeId(null);
    setRelationCandidates([]);
    setRelationError("");
  }

  function cancelDraftRelation() {
    // 只删除本次新建、尚未确认的边（draftEdgeId）；编辑已有边时取消不删除
    if (draftEdgeId) setEdges((current) => current.filter((edge) => edge.id !== draftEdgeId));
    setRelationSource(null);
    setEditingEdgeId(null);
    setDraftEdgeId(null);
    setRelationCandidates([]);
    setRelationError("");
  }

  async function generateOutput() {
    if (!adopted.length) return;
    setIsConverging(true);
    setConvergeError("");
    setRequest("graph.concept.v1 · Story Agent 收敛中");
    try {
      const workflow = await startWorkflow({ intent: "concept", needRag: false });
      const concept = workflow.candidateResult as StoryConcept;
      if (!concept?.concept) throw new Error("Workflow 未返回剧情");
      setStoryConcept(concept);
      if (!projectId) throw new Error("项目不存在");
      const saveResponse = await fetch(`/api/projects/${projectId}/stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphRevision: workflow.graphRevision, content: concept }),
      });
      const savePayload = await readApiEnvelope<{ version: number }>(saveResponse);
      if (!saveResponse.ok || !savePayload.ok) throw new Error(savePayload.error?.message || "剧情版本保存失败");
      setTraceId(`story-v${savePayload.result.version}`);
      setRequest("graph.concept.v1 · 引用校验通过");
      setStage("output");
    } catch (error) {
      setConvergeError(error instanceof Error ? error.message : "剧情收敛失败");
      setRequest("graph.concept.v1 · 失败");
    } finally {
      setIsConverging(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">织</span><div><strong>创意织图</strong><small>Creative Graph Lab</small></div></div>
        <div className="steps">
          {[["brief", "01", "输入 Brief"], ["graph", "02", "构建图谱"], ["output", "03", "剧情输出"]].map(([key, num, label]) => (
            <button key={key} className={stage === key ? "step active" : "step"} onClick={() => setStage(key as typeof stage)}><b>{num}</b>{label}</button>
          ))}
        </div>
        <div className="system-pill"><span /> DeepSeek · 4 Agents · rev {revision}</div>
      </header>

      {stage === "brief" && <section className="brief-page">
        <div className="hero-copy">
          <p className="eyebrow">FROM A BRIEF TO A TRACEABLE STORY</p>
          <h1>把零散灵感，织成<br/><em>可控制的创意图谱</em></h1>
          <p className="lead">AI 负责发散，人负责选择。每一个剧情节拍都能追溯到你采用的节点和关系。</p>
          <div className="principles"><span>确定性业务规则</span><span>结构化 AI 候选</span><span>人在回路中</span></div>
        </div>
        <div className="brief-card expanded-brief">
          <div className="card-heading"><div><small>CREATIVE BRIEF</small><h2>开始一次创意发散</h2></div><span className="required">推广对象与至少 1 个碎片想法必填</span></div>
          <label>推广对象 <em>（必填）</em><input value={product} onChange={(e) => setProduct(e.target.value)} /></label>
          <label>已知信息<textarea className="known-textarea" value={knownInformation} onChange={(e) => setKnownInformation(e.target.value)} /></label>

          <div className="ideas-heading"><div><strong>碎片想法 <em>（至少填写 1 个）</em></strong><small>每条只写一个人物、道具、冲突或事件想法</small></div><button type="button" className="add-idea" onClick={addIdea}>＋ 增加想法</button></div>
          <div className="ideas-grid">
            {ideas.map((ideaValue, index) => <label className="idea-field" key={index}><span>碎片想法 {index + 1}</span><div><input value={ideaValue} onChange={(event) => updateIdea(index, event.target.value)} placeholder="输入一个零散创意"/><button type="button" onClick={() => removeIdea(index)} disabled={ideas.length === 1} aria-label={`删除碎片想法 ${index + 1}`}>−</button></div></label>)}
          </div>
          {!hasRequiredIdea && <p className="field-error">至少填写一个碎片想法</p>}

          <div className="two-cols"><label>必须保留<input value={mustKeep} onChange={(e) => setMustKeep(e.target.value)} /></label><label>不想出现<input value={mustAvoid} onChange={(e) => setMustAvoid(e.target.value)} /></label></div>

          <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}><span>高级约束 <small>（选填）</small></span><b>{advancedOpen ? "⌃" : "⌄"}</b></button>
          {advancedOpen && <div className="advanced-panel">
            <label>目标受众<input value={audience} onChange={(e) => setAudience(e.target.value)} /></label>
            <label>投放平台<select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="wechat_channels">视频号</option></select></label>
            <label>视频时长<select value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))}><option value={15}>15 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option></select></label>
            <label>内容风格<input value={styles} onChange={(e) => setStyles(e.target.value)} /></label>
            <label>网络热梗<input value={hotMemes} onChange={(e) => setHotMemes(e.target.value)} /></label>
            <label>产品卖点<input value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} /></label>
          </div>}
          {generationError && <p className="generation-error">{generationError}</p>}
          <button className="primary" onClick={runInitialGeneration} disabled={!product.trim() || !hasRequiredIdea || isGenerating}>{isGenerating ? "四个 Agent 正在协作…" : "生成首轮创意图谱"} <b>{isGenerating ? "···" : "→"}</b></button>
          <p className="microcopy">将创建 3 个固定分类，并生成每类 2 个结构化候选节点</p>
        </div>
      </section>}

      {stage === "graph" && <section className="workspace">
        <div className="workspace-head">
          <div><p className="eyebrow">CREATIVE KNOWLEDGE GRAPH</p><h2>{product} · 创意探索</h2></div>
          <div className="graph-stats"><span><b>{nodes.length}</b> 节点</span><span><b>{adopted.length}</b> 已采用</span><span><b>{nodes.filter((n) => n.status === "needs_review").length}</b> 需复核</span><span><b>{edges.length}</b> 语义关系</span><span className="ready"><i style={{width: `${readiness}%`}}/>准备度 {readiness}%</span></div>
          <div className="head-actions">
            <button className="secondary compact" onClick={autoLayout}>⇅ 按层级整理</button>
            <button className="primary compact" disabled={!adopted.length || isConverging} onClick={generateOutput}>{isConverging ? "Story Agent 收敛中…" : "收敛为剧情 →"}</button>
          </div>
        </div>
        <div className="workspace-grid">
          <aside className="architecture-panel">
            <p className="panel-kicker">运行链路</p>
            <div className="arch-step"><b>00</b><div><strong>Brief Normalizer</strong><small>Global Brief / Constraints</small></div><i>↓</i></div>
            {(agentTrace.length ? agentTrace : [
              { agent: "Supervisor", status: "waiting", summary: "任务理解与路由" },
              { agent: "Creative", status: "waiting", summary: "三类候选生成" },
              { agent: "Critic", status: "waiting", summary: "语义审查与局部 Repair" },
              { agent: "Story", status: "waiting", summary: "可叙事准备度检查" },
            ] as AgentTrace[]).map((item, index) => <div className={`arch-step agent-${item.status}`} key={item.agent}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.agent} Agent</strong><small>{item.summary}</small></div>{index < 3 && <i>↓</i>}</div>)}
            <div className="arch-step"><b>05</b><div><strong>Validator + Commit</strong><small>{request} · graphRevision {revision}</small></div></div>
            <div className="fact-box"><strong>事实边界</strong><p>AI 只生成候选；采用、删除、关系保存和版本更新由确定性业务代码执行。</p></div>
          </aside>

          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 画布容器：点击空白处取消关系编辑，键盘 Esc 已全局支持 */}
          <div
            className={`canvas ${relationSource ? "relation-mode" : ""} ${dragState ? "dragging" : ""}`}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const px = (event.clientX - rect.left) * 920 / rect.width;
              const py = (event.clientY - rect.top) * 650 / rect.height;
              setPointer({ x: px, y: py });
              if (dragState) {
                if (movedRef.current || Math.hypot(px - pointer.x, py - pointer.y) > 0.5) movedRef.current = true;
                const nx = Math.max(0, Math.min(832, px - dragState.offsetX));
                const ny = Math.max(120, Math.min(558, py - dragState.offsetY));
                setNodes((current) => current.map((node) => node.id === dragState.id ? { ...node, x: nx, y: ny } : node));
              }
            }}
            onMouseUp={() => { void finishDrag(); }}
            onMouseLeave={() => { void finishDrag(); }}
            onClick={() => { if ((relationSource || editingEdgeId) && !movedRef.current) cancelDraftRelation(); }}
          >
            <div className="source-node"><span>推广对象</span><strong>{product}</strong></div>
            <svg className="lines" viewBox="0 0 920 650" preserveAspectRatio="none">
              <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
              {Object.values(categoryMeta).map((meta) => <line key={meta.label} x1="460" y1="91" x2={meta.x} y2="178" className="hierarchy" />)}
              {nodes.filter((n) => n.parentId).map((node) => { const p = nodes.find((n) => n.id === node.parentId); return p ? <line key={`h-${node.id}`} x1={p.x + 44} y1={p.y + 44} x2={node.x + 44} y2={node.y + 44} className="hierarchy"/> : null; })}
              {edges.map((edge) => { const a = nodes.find((n) => n.id === edge.source); const b = nodes.find((n) => n.id === edge.target); return a && b ? <line key={edge.id} x1={a.x + 44} y1={a.y + 44} x2={b.x + 44} y2={b.y + 44} className={`semantic ${editingEdgeId === edge.id ? "editing" : ""}`} markerEnd={edge.direction !== "reverse" ? "url(#arrow)" : undefined} markerStart={edge.direction !== "forward" ? "url(#arrow)" : undefined}/> : null; })}
              {relationSource && !editingEdgeId && (() => { const a = nodes.find((node) => node.id === relationSource); return a ? <line x1={a.x + 44} y1={a.y + 44} x2={pointer.x} y2={pointer.y} className="relation-preview" /> : null; })()}
            </svg>
            {edges.map((edge) => { const a = nodes.find((n) => n.id === edge.source); const b = nodes.find((n) => n.id === edge.target); return a && b ? <button key={`label-${edge.id}`} className={`edge-label ${editingEdgeId === edge.id ? "active" : ""}`} style={{left: (a.x + b.x) / 2 + 44, top: (a.y + b.y) / 2 + 44}} onClick={(event) => { event.stopPropagation(); setEditingEdgeId(edge.id); setRelationSource(edge.source); setDraftRelation({label: edge.label, direction: edge.direction || "forward"}); }}>{edge.label}</button> : null; })}
            {Object.entries(categoryMeta).map(([key, meta]) => <div key={key} className="category-node" style={{left: meta.x - 48, top: 130, borderColor: meta.color, color: meta.color}}>{meta.label}</div>)}
            {nodes.map((node) => <div key={node.id} role="button" tabIndex={0}
              onClick={(event) => { event.stopPropagation(); if (!movedRef.current) nodeClick(node); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") nodeClick(node); }}
              onMouseDown={(event) => {
                if (relationSource || editingEdgeId) return; // 关系模式下不拖拽
                event.stopPropagation();
                const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const px = (event.clientX - canvas.left) * 920 / canvas.width;
                const py = (event.clientY - canvas.top) * 650 / canvas.height;
                movedRef.current = false;
                setDragState({ id: node.id, offsetX: px - node.x, offsetY: py - node.y });
                setSelectedId(node.id);
              }}
              className={`graph-node ${node.status} ${selectedId === node.id ? "selected" : ""} ${relationSource === node.id ? "connecting" : ""} ${relationSource && relationSource !== node.id ? "valid-target" : ""}`} style={{left: node.x, top: node.y, borderColor: categoryMeta[node.category].color}} title={node.description}>
              <span className="node-state">{node.status === "adopted" ? "✓" : node.status === "excluded" ? "×" : node.status === "needs_review" ? "!" : "○"}</span>
              <strong>{node.title}</strong><small>{node.subtype || categoryMeta[node.category].label}</small>
              {node.growthMode && <span className="growth-badge">生长候选</span>}
              {(selectedId === node.id || relationSource === node.id) && <button className="connector-dot" aria-label={`从${node.title}建立关系`} onClick={(event) => { event.stopPropagation(); startRelation(node); }} />}
              {selectedId === node.id && !relationSource && <button className="node-grow" onClick={(event) => { event.stopPropagation(); openGrowth(node); }}>＋ 继续生长</button>}
            </div>)}
            {relationSource && <div className="relation-tip">请选择另一个内容节点建立关系 · Esc 可取消</div>}
            {editingEdgeId && (() => { const edge = edges.find((item) => item.id === editingEdgeId); const a = nodes.find((n) => n.id === edge?.source); const b = nodes.find((n) => n.id === edge?.target); return edge && a && b ? (
              /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 浮层容器阻止冒泡到画布 */
              <div className="relation-editor" style={{left: (a.x + b.x) / 2 + 44, top: (a.y + b.y) / 2 + 58}} onClick={(event) => event.stopPropagation()}>
              {isLoadingRelations ? <div className="relation-loading">Creative Agent 生成关系候选…</div> : relationCandidates.length ? (
                <div className="relation-candidates">{relationCandidates.map((candidate) => <button key={candidate.label} className={draftRelation.label === candidate.label ? "active" : ""} title={candidate.rationale} onClick={() => setDraftRelation({ label: candidate.label, direction: candidate.direction })}>{candidate.label}</button>)}</div>
              ) : (
                <div className="relation-candidates"><button onClick={() => setDraftRelation((value) => ({...value, label: "触发并推动"}))}>触发并推动</button><button onClick={() => setDraftRelation((value) => ({...value, label: "阻碍并升级"}))}>阻碍并升级</button><button onClick={() => setDraftRelation((value) => ({...value, label: "形成反转"}))}>形成反转</button></div>
              )}
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- 打开编辑器即聚焦输入，提升演示效率 */}
              <input value={draftRelation.label} onChange={(event) => setDraftRelation((value) => ({...value, label: event.target.value}))} placeholder="输入关系" autoFocus />
              <div className="direction-picker"><button className={draftRelation.direction === "forward" ? "active" : ""} onClick={() => setDraftRelation((value) => ({...value, direction: "forward"}))}>起点→终点</button><button className={draftRelation.direction === "reverse" ? "active" : ""} onClick={() => setDraftRelation((value) => ({...value, direction: "reverse"}))}>终点→起点</button><button className={draftRelation.direction === "both" ? "active" : ""} onClick={() => setDraftRelation((value) => ({...value, direction: "both"}))}>双向</button></div>
              {relationError && <p>{relationError}</p>}<div className="editor-actions"><button onClick={cancelDraftRelation}>取消</button><button className="confirm" onClick={saveRelation}>确认关系</button></div>
              </div>
            ) : null; })()}
          </div>

          <aside className="detail-panel">
            {!selected && <div className="empty-detail"><span>↖</span><h3>选择一个创意节点</h3><p>查看结构化字段、来源和可执行操作。</p></div>}
            {selected && <>
              <p className="panel-kicker">NODE DETAIL</p>
              <div className="detail-title"><span style={{background: categoryMeta[selected.category].color}}/><div><h3>{selected.title}</h3><small>{selected.id}</small></div></div>
              {editingNode ? (
                <div className="edit-form">
                  <label>名称<input value={editDraft.title} onChange={(e) => setEditDraft((v) => ({ ...v, title: e.target.value }))} /></label>
                  <label>描述<textarea value={editDraft.description} onChange={(e) => setEditDraft((v) => ({ ...v, description: e.target.value }))} /></label>
                  <label>子类型<input value={editDraft.subtype} onChange={(e) => setEditDraft((v) => ({ ...v, subtype: e.target.value }))} placeholder="如：人物、道具、对抗" /></label>
                  <div className="editor-actions"><button onClick={cancelEditNode}>取消</button><button className="confirm" onClick={() => saveEditNode(selected.id)}>保存编辑</button></div>
                </div>
              ) : (
                <>
                  <p className="description">{selected.description}</p>
                  {selected.status === "needs_review" && (
                    <div className="needs-review-banner">
                      <strong>该节点依赖的内容已被编辑</strong>
                      <p>请复核后重新确认；确认前不会进入最终剧情。</p>
                      <button className="confirm" onClick={() => confirmNeedsReview(selected.id)}>确认仍采用</button>
                    </div>
                  )}
                  <dl>
                    <div><dt>类别</dt><dd>{categoryMeta[selected.category].label}</dd></div>
                    <div><dt>子类型</dt><dd>{selected.subtype || "通用"}</dd></div>
                    <div><dt>状态</dt><dd>{statusLabel(selected.status)}</dd></div>
                    <div><dt>来源</dt><dd>{selected.provenance}</dd></div>
                    <div><dt>生成深度</dt><dd>{selected.depth ?? 1}{selected.originalDepth && selected.originalDepth !== selected.depth ? `（原 ${selected.originalDepth}）` : ""}</dd></div>
                    <div><dt>重要性</dt><dd>
                      <span className="importance-picker">
                        {[1, 2, 3, 4, 5].map((level) => <button key={level} className={(selected.importance || 3) >= level ? "on" : ""} onClick={() => updateImportance(selected.id, level)} aria-label={`重要性 ${level}`}>★</button>)}
                      </span>
                    </dd></div>
                  </dl>
                  <div className="action-grid">
                    <button onClick={() => updateStatus(selected.id, "adopted")}>✓ 采用</button>
                    <button onClick={() => updateStatus(selected.id, "excluded")}>× 排除</button>
                    <button onClick={() => updateStatus(selected.id, "candidate")}>↺ 恢复待选</button>
                    <button onClick={() => startEditNode(selected)}>✎ 编辑</button>
                    <button onClick={() => openGrowth(selected)}>＋ 继续生长</button>
                    <button onClick={() => startRelation(selected)}>↗ 建立关系</button>
                    <button className="danger" onClick={() => openDeleteConfirm(selected)}>🗑 删除</button>
                  </div>
                </>
              )}
              {deleteConfirm && deleteConfirm.nodeId === selected.id && (
                <div className="delete-confirm">
                  <strong>删除「{deleteConfirm.nodeTitle}」</strong>
                  {deleteConfirm.descendantCount > 0 && <p>该节点有 {deleteConfirm.descendantCount} 个后代节点。</p>}
                  <div className="editor-actions">
                    <button onClick={() => setDeleteConfirm(null)}>取消</button>
                    <button onClick={() => deleteNodeOnly(deleteConfirm.nodeId)}>仅删当前节点{deleteConfirm.descendantCount > 0 ? "（后代上移）" : ""}</button>
                    {deleteConfirm.descendantCount > 0 && <button className="danger" onClick={() => deleteCascade(deleteConfirm.nodeId)}>级联删除（{deleteConfirm.descendantCount + 1} 个节点）</button>}
                  </div>
                </div>
              )}
              {growthOpen && <section className="growth-panel">
                <div className="growth-head"><div><small>CONTROLLED GROWTH</small><h4>从“{selected.title}”继续生长</h4></div><button onClick={() => setGrowthOpen(false)} aria-label="关闭生长设置">×</button></div>
                <div className="anchor-card"><span>推广主体</span><strong>{product}</strong><em>始终携带</em></div>
                <div className={`anchor-card ${narrativeAnchor ? "safe" : "warning"}`}><span>叙事主体</span><strong>{narrativeAnchor?.title || "尚未采用人物节点"}</strong><em>{narrativeAnchor ? "已锚定" : "建议先采用主体"}</em></div>
                <div className="path-preview"><span>祖先路径</span><div>{ancestorPath(selected).map((node, index) => <b key={node.id}>{index > 0 && <i>→</i>}{node.title}</b>)}</div></div>
                <p className="growth-label">选择生长方向</p>
                <div className="growth-modes">{growthModes.map((mode) => <button key={mode.id} className={growthMode === mode.id ? "active" : ""} onClick={() => { setGrowthMode(mode.id); if (mode.category) setGrowthCategory(mode.category); }}><strong>{mode.label}</strong><small>{mode.hint}</small></button>)}</div>
                {!growthModes.find((mode) => mode.id === growthMode)?.category && <div className="category-picker"><span>生成类型</span>{(Object.keys(categoryMeta) as Category[]).map((category) => <button key={category} className={growthCategory === category ? "active" : ""} onClick={() => setGrowthCategory(category)}>{categoryMeta[category].label}</button>)}</div>}
                <label className="growth-instruction">补充要求（可选）<textarea value={growthInstruction} onChange={(event) => setGrowthInstruction(event.target.value)} placeholder="例如：保持轻松荒诞，不增加新主角" /></label>
                <div className="growth-footer"><div><span>候选数量</span><button disabled={isGrowing} className={growthCount === 2 ? "active" : ""} onClick={() => setGrowthCount(2)}>2</button><button disabled={isGrowing} className={growthCount === 3 ? "active" : ""} onClick={() => setGrowthCount(3)}>3</button></div><button disabled={isGrowing} className="generate-growth" onClick={() => executeGrowth(selected)}>{isGrowing ? "四 Agent 生成中…" : "生成候选 →"}</button></div>
                <div className="guard-row"><span>✓ Global Brief</span><span>✓ 主体契约</span><span>✓ 已采用邻域</span><span>✓ 排除记忆</span></div>
                {growthError && <p className="growth-error">{growthError}</p>}
              </section>}
              <div className="json-preview"><div><span>STRUCTURED DATA</span><b>JSON</b></div><pre>{JSON.stringify({id:selected.id, category:selected.category, subtype:selected.subtype, attributes:selected.attributes, status:selected.status, revision}, null, 2)}</pre></div>
            </>}
          </aside>
        </div>
      </section>}

      {stage === "output" && <section className="output-page">
        <div className="output-intro"><p className="eyebrow">TRACEABLE STORY OUTPUT</p><h1>每一个剧情节拍，<br/>都有图谱依据。</h1><p>系统只读取已采用子图；未采用和已排除节点不会进入最终生成上下文。</p><button className="secondary" onClick={() => setStage("graph")}>← 返回图谱调整</button></div>
        {convergeError && <p className="generation-error">{convergeError}</p>}
        <div className="story-card">
          <div className="story-head"><div><small>ONE-LINE CONCEPT</small><h2>{storyConcept?.concept || "每个人都有十秒钟，成为水世界国王。"}</h2></div><span>{traceId || "story-draft"}</span></div>
          {storyConcept && <div className="story-meta"><div><small>核心主题</small><strong>{storyConcept.theme}</strong></div><div><small>叙事视角</small><strong>{storyConcept.perspective}</strong></div><div><small>故事主线</small><strong>{storyConcept.main_line}</strong></div></div>}
          <div className="concept-grid">
            <div><small>核心冲突</small><strong>{storyConcept?.core_conflict || "现任国王抵挡全场挑战者"}</strong></div>
            <div><small>卖点植入</small><strong>{storyConcept?.selling_point_insertion || "水枪玩法即剧情机制"}</strong></div>
            <div><small>记忆点</small><strong>{storyConcept?.twist || "透明王冠最后一秒换人"}</strong></div>
          </div>
          <div className="beats">{(storyConcept?.beats?.length ? storyConcept.beats : story).map((beat, index) => <article key={beat.phase + index}><b>{String(index + 1).padStart(2,"0")}</b><div><small>{beat.phase}</small><p>{beat.text}</p><div className="refs">{beat.refs.map((ref) => <span key={ref}>↗ {nodes.find((n) => n.id === ref)?.title || ref}</span>)}{!beat.refs.length && <span>Brief 约束</span>}</div></div></article>)}</div>
          {storyConcept?.shooting_feasibility && <div className="shooting-note"><small>拍摄可行性</small><p>{storyConcept.shooting_feasibility}</p></div>}
          <div className="validation-bar"><span>✓ Schema</span><span>✓ 节点引用</span><span>✓ {durationSeconds} 秒时长</span><span>✓ 禁用内容</span><strong>{isConverging ? "Story Agent 生成中…" : "validation passed"}</strong></div>
        </div>
        <aside className="output-side"><div><small>来源图谱</small><strong>revision {revision}</strong></div><div><small>已采用节点</small><strong>{adopted.length}</strong></div><div><small>已采用关系</small><strong>{adoptedEdges.length}</strong></div><div><small>生成方式</small><strong>{storyConcept ? "Story Agent" : "前端模板"}</strong></div><p>输出保存为新版本，不覆盖此前剧情。用户可按节拍局部修改并选择性接受。</p></aside>
      </section>}
    </main>
  );
}
