"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  ApiError,
  commitGraph as apiCommitGraph,
  createProject,
  deleteProject as apiDeleteProject,
  getGraphSnapshot,
  getProject,
  getWorkflowThread,
  listProjects,
  listStories,
  resumeWorkflow as apiResumeWorkflow,
  reviseStory,
  saveStory,
  startWorkflow as apiStartWorkflow,
  updateProject,
  type GraphSnapshot,
  type ProjectSummary,
} from "../lib/client/api-client";

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
type GraphOperation =
  | { type: "ADD_NODE"; node: Record<string, unknown> }
  | { type: "ADD_EDGE"; edge: Record<string, unknown> }
  | { type: "ADOPT_NODE" | "EXCLUDE_NODE" | "RESTORE_NODE"; nodeId: string }
  | { type: "UPDATE_NODE"; nodeId: string; patch: Record<string, unknown> }
  | { type: "DELETE_NODE"; nodeId: string; cascade?: boolean }
  | { type: "ADOPT_EDGE" | "EXCLUDE_EDGE" | "DELETE_EDGE"; edgeId: string };

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
      status: node.status as Status,
      x: node.position?.x ?? 100,
      y: node.position?.y ?? 250,
      parentId: node.parentId ?? undefined,
      provenance: node.provenance ?? "Server persisted",
      attributes: node.attributes,
      growthMode: node.growthMode as GrowthMode | undefined,
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
      status: edge.status as Edge["status"],
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

const INITIAL_SOURCE_POSITION = { x: 400, y: 20 };
const INITIAL_CATEGORY_POSITIONS: Record<Category, { x: number; y: number }> = {
  creative_element: { x: 102, y: 130 },
  motivation_conflict: { x: 402, y: 130 },
  story_event: { x: 702, y: 130 },
};
const INITIAL_PAN_OFFSET = { x: 0, y: 0 };
const SYSTEM_LAYOUT_KEY = "creative-graph-system-layout-v1";

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

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeFileName(name: string) {
  const cleaned = (name || "creative-story").replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "creative-story";
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [stage, setStage] = useState<"projects" | "brief" | "graph" | "output">("projects");
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
  const [exportNotice, setExportNotice] = useState("");
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [edgeMode, setEdgeMode] = useState<"all" | "hierarchy" | "semantic">("all");
  const [layoutMode, setLayoutMode] = useState<"free" | "hierarchy">("free");
  const [selectedGrowIds, setSelectedGrowIds] = useState<string[]>([]);
  const [adoptingAll, setAdoptingAll] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiDiff, setAiDiff] = useState<{ before: unknown; after: unknown; changes: unknown[] } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [sourceNodePos, setSourceNodePos] = useState(() => {
    if (typeof window === "undefined") return INITIAL_SOURCE_POSITION;
    try {
      const parsed = JSON.parse(localStorage.getItem(SYSTEM_LAYOUT_KEY) ?? "null") as { source?: { x: number; y: number } };
      return parsed.source ?? INITIAL_SOURCE_POSITION;
    } catch {
      return INITIAL_SOURCE_POSITION;
    }
  });
  const [categoryNodePos, setCategoryNodePos] = useState(() => {
    if (typeof window === "undefined") return INITIAL_CATEGORY_POSITIONS;
    try {
      const parsed = JSON.parse(localStorage.getItem(SYSTEM_LAYOUT_KEY) ?? "null") as { categories?: Partial<Record<Category, { x: number; y: number }>> };
      return { ...INITIAL_CATEGORY_POSITIONS, ...parsed.categories };
    } catch {
      return INITIAL_CATEGORY_POSITIONS;
    }
  });
  const [panOffset, setPanOffset] = useState(() => {
    if (typeof window === "undefined") return INITIAL_PAN_OFFSET;
    try {
      const parsed = JSON.parse(localStorage.getItem(SYSTEM_LAYOUT_KEY) ?? "null") as { pan?: { x: number; y: number } };
      return parsed.pan ?? INITIAL_PAN_OFFSET;
    } catch {
      return INITIAL_PAN_OFFSET;
    }
  });
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);

  // 节点拖拽（FR-03 自由布局基础版）
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const movedRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const pendingCandidateIdsRef = useRef<Set<string>>(new Set());
  const spacePressedRef = useRef(false);
  const panDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const workflowThreadIdRef = useRef<string | null>(null);
  const relationLoadRef = useRef<Promise<void> | null>(null);
  const relationLoadTokenRef = useRef(0);

  // localStorage 只保存服务端项目指针；Project/Graph/Story 的唯一事实源是 API。
  const SESSION_KEY = "creative-graph-project-v2";
  const THREAD_KEY = "creative-graph-thread-v2";
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    pendingCandidateIdsRef.current = pendingCandidateIds;
  }, [pendingCandidateIds]);
  useEffect(() => {
    localStorage.setItem(SYSTEM_LAYOUT_KEY, JSON.stringify({ source: sourceNodePos, categories: categoryNodePos, pan: panOffset }));
  }, [sourceNodePos, categoryNodePos, panOffset]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      if (!event.repeat) {
        spacePressedRef.current = true;
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spacePressedRef.current = false;
      setSpacePressed(false);
      panDragRef.current = null;
      setPanning(false);
    };
    const handleBlur = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
      panDragRef.current = null;
      setPanning(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);
  useEffect(() => {
    const savedProjectId = localStorage.getItem(SESSION_KEY);
    if (!savedProjectId) return;
    void (async () => {
      try {
        const [projectPayload, graphPayload, storyPayload] = await Promise.all([
          getProject(savedProjectId),
          getGraphSnapshot(savedProjectId),
          listStories(savedProjectId),
        ]);
        const brief = projectPayload.brief as unknown as Record<string, unknown>;
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
        const graph = toUiGraph(graphPayload);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setRevision(graph.revision);
        const latestStory = storyPayload.at(-1)?.content as StoryConcept | undefined;
        if (latestStory) setStoryConcept(latestStory);
        setStage(latestStory ? "output" : graph.nodes.length ? "graph" : "brief");
        setRequest("已从服务端恢复项目");
        const savedThreadId = localStorage.getItem(THREAD_KEY);
        if (savedThreadId) {
          const workflowState = await getWorkflowThread(savedThreadId);
          if (workflowState.next.length) {
            setWorkflowThreadId(savedThreadId);
            workflowThreadIdRef.current = savedThreadId;
            const state = workflowState;
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
    if (stage === "projects") void loadProjects();
  }, [stage]);

  async function loadProjects() {
    setProjectsLoading(true);
    setProjectsError("");
    try {
      setProjectList(await listProjects());
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "项目列表加载失败");
    } finally {
      setProjectsLoading(false);
    }
  }

  function beginNewProject() {
    setProjectId(null);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(THREAD_KEY);
    setWorkflowThreadId(null);
    workflowThreadIdRef.current = null;
    setNodes([]);
    setEdges([]);
    setRevision(0);
    setStoryConcept(null);
    setStage("brief");
  }

  function openProjectFromList(targetProjectId: string) {
    localStorage.setItem(SESSION_KEY, targetProjectId);
    setProjectId(targetProjectId);
    window.location.reload();
  }

  function startRename(targetProjectId: string, currentName: string) {
    setRenamingId(targetProjectId);
    setRenameDraft(currentName);
  }

  async function saveRename() {
    if (!renamingId || !renameDraft.trim()) return;
    try {
      const updated = await updateProject(renamingId, { name: renameDraft.trim() });
      setProjectList((current) => current.map((item) => item.id === updated.id ? { ...item, name: updated.name, updatedAt: updated.updatedAt } : item));
      setRenamingId(null);
      setRenameDraft("");
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "重命名失败");
    }
  }

  async function removeProjectFromList(targetProjectId: string) {
    if (deletingId) return;
    setDeletingId(targetProjectId);
    try {
      await apiDeleteProject(targetProjectId);
      setProjectList((current) => current.filter((item) => item.id !== targetProjectId));
      if (targetProjectId === projectId) {
        setProjectId(null);
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(THREAD_KEY);
      }
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

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

  const visibleNodes = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return nodes;
    return nodes.filter((node) => `${node.title} ${node.description} ${node.subtype || ""}`.toLowerCase().includes(keyword));
  }, [nodes, searchText]);

  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleHierarchyEdges = nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) => ({
      id: `h-${node.parentId ?? `system-category-${node.category}`}-${node.id}`,
      sourceId: node.parentId ?? `system-category-${node.category}`,
      targetId: node.id,
    }))
    .filter((edge) => edge.sourceId.startsWith("system-category-") || visibleNodeIds.has(edge.sourceId));
  const visibleSemanticEdges = edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));

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

  function storyExportData() {
    const concept = storyConcept;
    const beats = concept?.beats?.length ? concept.beats : story;
    return {
      concept: concept?.concept || "每个人都有十秒钟，成为水世界国王。",
      theme: concept?.theme || "规则即乐趣：谁都能挑战王座",
      perspective: concept?.perspective || "第三人称轻喜剧",
      coreConflict: concept?.core_conflict || "现任国王抵挡全场挑战者",
      mainLine: concept?.main_line || "从被低估到逆转，完成水世界王位传承。",
      beats,
      sellingPoint: concept?.selling_point_insertion || "水枪玩法即剧情机制",
      twist: concept?.twist || "透明王冠最后一秒换人",
      cta: concept?.cta || `来${product}，下一任水世界国王可能就是你。`,
      shooting: concept?.shooting_feasibility || "",
    };
  }

  function storyMarkdown() {
    const data = storyExportData();
    const lines = [
      `# ${product} · 30 秒广告剧情方案`,
      "",
      `- 一句话创意：${data.concept}`,
      `- 核心主题：${data.theme}`,
      `- 叙事视角：${data.perspective}`,
      `- 核心冲突：${data.coreConflict}`,
      `- 故事主线：${data.mainLine}`,
      "",
      "## 分镜表",
      "",
    ];
    data.beats.forEach((beat, index) => {
      const refs = beat.refs.length ? beat.refs.map((ref) => nodes.find((node) => node.id === ref)?.title || ref).join("、") : "Brief 约束";
      lines.push(`${String(index + 1).padStart(2, "0")}. **${beat.phase}**  ${beat.text}`);
      lines.push(`   依据：${refs}`);
      lines.push("");
    });
    lines.push("## 产品与执行", "");
    lines.push(`- 卖点植入：${data.sellingPoint}`);
    lines.push(`- 反转 / 记忆点：${data.twist}`);
    lines.push(`- CTA：${data.cta}`);
    if (data.shooting) lines.push(`- 拍摄可行性：${data.shooting}`);
    lines.push("");
    lines.push(`> 图谱依据：revision ${revision} · 已采用 ${adopted.length} 个节点 · 已采用关系 ${adoptedEdges.length} 条`);
    return lines.join("\n");
  }

  function exportStoryMarkdown() {
    downloadTextFile(`${safeFileName(product)}-剧情方案.md`, storyMarkdown(), "text/markdown;charset=utf-8");
  }

  function exportStoryCsv() {
    const data = storyExportData();
    const header = ["镜头号", "节拍", "画面 / 台词", "图谱依据"];
    const rows = data.beats.map((beat, index) => [
      String(index + 1),
      beat.phase,
      beat.text,
      beat.refs.length ? beat.refs.map((ref) => nodes.find((node) => node.id === ref)?.title || ref).join("、") : "Brief 约束",
    ]);
    const csv = "\ufeff" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadTextFile(`${safeFileName(product)}-分镜表.csv`, csv, "text/csv;charset=utf-8");
  }

  async function copyStoryText() {
    try {
      await navigator.clipboard.writeText(storyMarkdown());
      setExportNotice("已复制全文");
    } catch {
      setExportNotice("复制失败，请手动选择");
    }
    window.setTimeout(() => setExportNotice(""), 2000);
  }

  function updateStoryField<K extends keyof StoryConcept>(field: K, value: StoryConcept[K]) {
    setStoryConcept((current) => current ? { ...current, [field]: value } : current);
  }

  function updateBeat(index: number, patch: Partial<StoryConcept["beats"][number]>) {
    setStoryConcept((current) => current ? { ...current, beats: current.beats.map((beat, beatIndex) => beatIndex === index ? { ...beat, ...patch } : beat) } : current);
  }

  async function saveStoryVersion() {
    if (!projectId || !storyConcept) return;
    try {
      const saved = await saveStory(projectId, { graphRevision: revision, content: storyConcept });
      setExportNotice(`已保存为版本 ${saved.version}`);
    } catch (error) {
      setExportNotice(error instanceof Error ? `保存失败：${error.message}` : "保存失败");
    }
  }

  async function generateAiDiff() {
    if (!storyConcept || !aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError("");
    try {
      const diff = await reviseStory({
        story: storyConcept,
        instruction: aiPrompt.trim(),
        adoptedNodes: adopted,
        adoptedEdges,
      });
      setAiDiff(diff);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 微调失败，请稍后重试");
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiDiff(acceptAll: boolean) {
    if (!aiDiff) return;
    if (acceptAll || !Array.isArray(aiDiff.changes) || !aiDiff.changes.length) {
      setStoryConcept(aiDiff.after as StoryConcept);
    } else {
      const first = aiDiff.changes[0] as { path?: string; after?: unknown };
      const changePath = first?.path;
      if (changePath) {
        setStoryConcept((current) => {
          if (!current) return current;
          const next = structuredClone(current) as Record<string, unknown>;
          const parts = changePath.split(/[./[\]]+/).filter(Boolean);
          let cursor: Record<string, unknown> = next;
          for (let index = 0; index < parts.length - 1; index += 1) {
            const part = parts[index];
            if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
            cursor = cursor[part] as Record<string, unknown>;
          }
          if (parts.length) cursor[parts[parts.length - 1]] = first.after;
          return next as unknown as StoryConcept;
        });
      }
    }
    setAiDiff(null);
    setAiPrompt("");
  }

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
    nodesRef.current = graph.nodes;
    pendingCandidateIdsRef.current = new Set();
  }

  async function ensureProject() {
    const brief = currentBrief();
    if (projectId) {
      try {
        await updateProject(projectId, { name: product, brief });
        return projectId;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    const created = await createProject({ name: product, brief });
    setProjectId(created.id);
    localStorage.setItem(SESSION_KEY, created.id);
    setRevision(0);
    return created.id;
  }

  async function commitOperations(operations: GraphOperation[], targetProjectId = projectId) {
    if (!targetProjectId) throw new Error("请先创建项目");
    try {
      const snapshot = await apiCommitGraph({
        projectId: targetProjectId,
        expectedRevision: revision,
        operationId: await operationIdFor(revision, operations),
        operations,
      });
      applyServerGraph(snapshot);
      return snapshot;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.details?.snapshot) {
        applyServerGraph(error.details.snapshot as GraphSnapshot);
      }
      throw error;
    }
  }

  async function operationIdFor(expectedRevision: number, operations: GraphOperation[]) {
    const bytes = new TextEncoder().encode(JSON.stringify({ projectId, expectedRevision, operations }));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function startWorkflow(input: Record<string, unknown>) {
    if (!projectId && !input.projectId) throw new Error("请先创建项目");
    const result = await apiStartWorkflow({ projectId: input.projectId ?? projectId, ...input });
    if (result.next.length) {
      setWorkflowThreadId(result.threadId);
      workflowThreadIdRef.current = result.threadId;
      localStorage.setItem(THREAD_KEY, result.threadId);
    } else {
      setWorkflowThreadId(null);
      workflowThreadIdRef.current = null;
      localStorage.removeItem(THREAD_KEY);
    }
    return result;
  }

  async function resumeWorkflow(operations: GraphOperation[], threadId = workflowThreadIdRef.current) {
    if (!threadId) throw new Error("没有可恢复的 Workflow");
    try {
      const result = await apiResumeWorkflow({
        threadId,
        decision: { action: "commit", operations },
      });
      if (result.graphSnapshot) applyServerGraph(result.graphSnapshot);
      setWorkflowThreadId(null);
      workflowThreadIdRef.current = null;
      setPendingCandidateIds(new Set());
      localStorage.removeItem(THREAD_KEY);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.details?.snapshot) {
        applyServerGraph(error.details.snapshot as GraphSnapshot);
      }
      throw error;
    }
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

  // 节点直接编辑（FR-04）：输入先更新本地画布，保存时统一提交服务端
  function updateNodeLocal(id: string, patch: Partial<Node>) {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, ...patch } : node));
  }
  function updateNodeAttribute(id: string, key: string, value: string) {
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, attributes: { ...(node.attributes || {}), [key]: value } }
      : node));
  }
  function addNodeAttribute(id: string) {
    setNodes((current) => current.map((node) => {
      const attributes = { ...(node.attributes || {}) };
      let index = 1;
      while (attributes[`自定义属性${index}`]) index += 1;
      attributes[`自定义属性${index}`] = "";
      return node.id === id ? { ...node, attributes } : node;
    }));
  }
  function removeNodeAttribute(id: string, key: string) {
    setNodes((current) => current.map((node) => {
      if (node.id !== id) return node;
      const attributes = { ...(node.attributes || {}) };
      delete attributes[key];
      return { ...node, attributes };
    }));
  }

  async function saveEditNode(id: string) {
    const target = nodes.find((n) => n.id === id);
    if (!target) return;
    const attributes = Object.fromEntries(
      Object.entries(target.attributes || {})
        .map(([key, value]) => [key, Array.isArray(value) ? value.join("、") : String(value)])
        .filter(([key, value]) => key.trim() && String(value).trim()),
    );
    const operations: GraphOperation[] = [{
      type: "UPDATE_NODE",
      nodeId: id,
      patch: {
        title: target.title.trim(),
        label: target.title.trim(),
        description: target.description.trim(),
        subtype: target.subtype?.trim() || undefined,
        attributes,
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
      setRequest(`domain.update · 节点已编辑${operations.length > 1 ? ` · ${operations.length - 1} 个依赖节点需复核` : ""}`);
    } catch (error) {
      setRequest(`编辑提交失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

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

  async function addManualNode() {
    const activeProjectId = projectId || await ensureProject();
    const category: Category = "creative_element";
    const id = `manual-${Date.now()}`;
    const position = freePosition(category, nodes);
    const node: Node = {
      id,
      title: "手动新增节点",
      description: "在右侧补充这个节点的具体内容，再由 Creative Agent 围绕它继续生长。",
      category,
      subtype: "自定义",
      status: "candidate",
      x: position.x,
      y: position.y,
      depth: 1,
      provenance: "用户手动创建",
      attributes: { 来源: "用户" },
      importance: 3,
    };
    try {
      await commitOperations([addNodeOperation(node)], activeProjectId);
      setSelectedId(id);
      setRequest("domain.addNode · 手动新增节点已提交");
    } catch (error) {
      setRequest(`手动新增节点失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  function positionForDrag(id: string) {
    if (id === "system-source") return sourceNodePos;
    if (id.startsWith("system-category-")) return categoryNodePos[id.replace("system-category-", "") as Category] ?? { x: 100, y: 200 };
    return nodes.find((node) => node.id === id) ?? { x: 0, y: 0 };
  }

  function nodeCenter(node: Node) {
    return { x: node.x + 44, y: node.y + 44 };
  }

  function semanticEdgePoints(edge: Edge) {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (!source || !target) return null;
    const a = nodeCenter(source);
    const b = nodeCenter(target);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!length) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    const unitX = dx / length;
    const unitY = dy / length;
    const markerMargin = 8;
    const sourceOffset = 44 + markerMargin;
    const targetOffset = 44 + markerMargin;
    return {
      x1: a.x + unitX * sourceOffset,
      y1: a.y + unitY * sourceOffset,
      x2: b.x - unitX * targetOffset,
      y2: b.y - unitY * targetOffset,
    };
  }

  function relationDraftPoint(sourceId: string, targetX: number, targetY: number) {
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) return null;
    const a = nodeCenter(source);
    const dx = targetX - a.x;
    const dy = targetY - a.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!length) return { x1: a.x, y1: a.y };
    return {
      x1: a.x + dx / length * 50,
      y1: a.y + dy / length * 50,
    };
  }

  function updateDraggedPosition(id: string, x: number, y: number) {
    if (id === "system-source") {
      setSourceNodePos({ x, y });
      return;
    }
    if (id.startsWith("system-category-")) {
      const category = id.replace("system-category-", "") as Category;
      setCategoryNodePos((current) => ({ ...current, [category]: { x, y } }));
      return;
    }
    setNodes((current) => current.map((node) => node.id === id ? { ...node, x, y } : node));
  }

  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (spacePressedRef.current) return;
    if (relationSource || editingEdgeId) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const px = event.clientX - canvas.left;
    const py = event.clientY - canvas.top;
    const current = positionForDrag(id);
    movedRef.current = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 捕获失败时仍可拖动 */ }
    setDragState({ id, offsetX: px - current.x, offsetY: py - current.y });
    setPointer({ x: px, y: py });
    if (id.startsWith("system-")) setSelectedId(null);
    else setSelectedId(id);
  }

  function moveNodeDrag(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (!dragState || dragState.id !== id) return;
    event.preventDefault();
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const px = event.clientX - canvas.left;
    const py = event.clientY - canvas.top;
    setPointer({ x: px, y: py });
    if (movedRef.current || Math.hypot(px - pointer.x, py - pointer.y) > 0.5) movedRef.current = true;
    const nx = px - dragState.offsetX;
    const ny = py - dragState.offsetY;
    updateDraggedPosition(id, nx, ny);
  }

  function endNodeDrag(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (!dragState || dragState.id !== id) return;
    event.preventDefault();
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 已释放 */ }
    void finishDrag();
  }

  function startCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!spacePressedRef.current || event.button !== 0) return;
    event.preventDefault();
    panDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: panOffset.x,
      originY: panOffset.y,
    };
    setPanning(true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 捕获失败时仍可拖动画布 */ }
  }

  function moveCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panDragRef.current) return;
    event.preventDefault();
    setPanOffset({
      x: panDragRef.current.originX + event.clientX - panDragRef.current.startX,
      y: panDragRef.current.originY + event.clientY - panDragRef.current.startY,
    });
  }

  function endCanvasPan(event?: ReactPointerEvent<HTMLDivElement>) {
    if (!panDragRef.current) return;
    if (event) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 已释放 */ }
    }
    panDragRef.current = null;
    setPanning(false);
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

  function growthPosition(parent: Node, index: number, occupied: Node[]) {
    const offsets = [
      { x: -100, y: 180 },
      { x: 115, y: 180 },
      { x: 0, y: 260 },
    ];
    const preferred = offsets[index % offsets.length];
    const base = { x: parent.x + preferred.x, y: parent.y + preferred.y };
    for (let distance = 0; distance < 5; distance += 1) {
      const candidate = { x: base.x + distance * 34, y: base.y + (distance % 2) * 28 };
      if (occupied.every((node) => Math.hypot(node.x - candidate.x, node.y - candidate.y) > 100)) return candidate;
    }
    return { x: parent.x + (index % 2 ? 130 : -130), y: parent.y + 230 + index * 24 };
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
      await commitPendingCandidatesIfNeeded();
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
        const currentNodes = nodesRef.current.length ? nodesRef.current : nodes;
        const position = growthPosition(parent, additions.length, [...currentNodes, ...additions]);
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
      const nextNodes = [...nodesRef.current, ...additions];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      const nextPending = new Set(pendingCandidateIdsRef.current);
      additions.forEach((node) => nextPending.add(node.id));
      pendingCandidateIdsRef.current = nextPending;
      setPendingCandidateIds(nextPending);
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
      const existingEdge = edges.find(
        (edge) => (edge.source === relationSource && edge.target === node.id) || (edge.source === node.id && edge.target === relationSource),
      );
      setSelectedId(node.id);
      if (existingEdge) {
        relationLoadTokenRef.current += 1;
        relationLoadRef.current = null;
        setRelationSource(null);
        setEditingEdgeId(existingEdge.id);
        setDraftEdgeId(null);
        setDraftRelation({ label: existingEdge.label, direction: existingEdge.direction || "forward" });
        setRelationCandidates([]);
        return;
      }
      const id = `edge-${Date.now()}`;
      setEdges((current) => [...current, { id, source: relationSource, target: node.id, label: "触发并推动", type: "semantic", direction: "forward", status: "pending" }]);
      setEditingEdgeId(id);
      setDraftEdgeId(id);
      setDraftRelation({ label: "触发并推动", direction: "forward" });
      setRelationCandidates([]);
      setRelationSource(null);
      const token = ++relationLoadTokenRef.current;
      relationLoadRef.current = loadRelationCandidates(relationSource, node.id, id, token);
      return;
    }
    setSelectedId(node.id);
  }

  async function loadRelationCandidates(sourceId: string, targetId: string, edgeId?: string, token = relationLoadTokenRef.current) {
    if (token !== relationLoadTokenRef.current) return;
    const activeEdgeId = edgeId ?? `edge-${Date.now()}`;
    if (!edgeId) {
      setEdges((current) => [...current, { id: activeEdgeId, source: sourceId, target: targetId, label: "触发并推动", type: "semantic", direction: "forward", status: "pending" }]);
      setEditingEdgeId(activeEdgeId);
      setDraftEdgeId(activeEdgeId);
    }
    if (token !== relationLoadTokenRef.current) return;
    setIsLoadingRelations(true);
    setRelationError("");
    try {
      await commitPendingCandidatesIfNeeded();
      if (token !== relationLoadTokenRef.current) return;
      const sourceNode = nodes.find((n) => n.id === sourceId);
      const targetNode = nodes.find((n) => n.id === targetId);
      if (!sourceNode || !targetNode) throw new Error("端点节点不存在");
      const workflow = await startWorkflow({ intent: "relations", sourceNodeId: sourceId, targetNodeId: targetId, needRag: false });
      if (token !== relationLoadTokenRef.current) return;
      const result = workflow.candidateResult as { relations?: RelationCandidate[] };
      const candidates: RelationCandidate[] = result?.relations || [];
      setRelationCandidates(candidates);
      if (candidates.length) setDraftRelation({ label: candidates[0].label, direction: candidates[0].direction });
      else setDraftRelation((value) => ({ ...value, label: value.label || "触发并推动" }));
    } catch (error) {
      if (token !== relationLoadTokenRef.current) return;
      setDraftRelation((value) => ({ ...value, label: value.label || "触发并推动" }));
      setRelationError(error instanceof Error ? `AI 推荐 failed（可手动输入）：${error.message}` : "AI 推荐 failed，可手动输入");
    } finally {
      if (token === relationLoadTokenRef.current) {
        setIsLoadingRelations(false);
        relationLoadRef.current = null;
      }
    }
  }

  async function commitPendingCandidatesIfNeeded() {
    const pending = nodesRef.current.filter((node) => pendingCandidateIdsRef.current.has(node.id));
    if (!pending.length) return;
    const operations = pending.map((node) => addNodeOperation(node));
    if (workflowThreadIdRef.current) await resumeWorkflow(operations, workflowThreadIdRef.current);
    else await commitOperations(operations);
    setPendingCandidateIds(new Set());
    pendingCandidateIdsRef.current = new Set();
  }

  async function adoptAllNodes() {
    const targets = nodes.filter((node) => node.status === "candidate");
    if (!targets.length || adoptingAll) return;
    setAdoptingAll(true);
    try {
      if (workflowThreadId && pendingCandidateIds.size) {
        const pendingNodes = nodes.filter((node) => pendingCandidateIds.has(node.id));
        const operations = pendingNodes.map((node) => addNodeOperation(node, targets.some((target) => target.id === node.id) ? "adopted" : node.status));
        await resumeWorkflow(operations);
        setPendingCandidateIds(new Set());
      } else {
        await commitOperations(targets.map((node) => ({ type: "ADOPT_NODE", nodeId: node.id })));
      }
      setRequest(`domain.adoptAll · 已采用 ${targets.length} 个节点`);
    } catch (error) {
      setRequest(`全部采用失败 · ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setAdoptingAll(false);
    }
  }

  function toggleGrowSelection(nodeId: string) {
    setSelectedGrowIds((current) => current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]);
  }

  async function growSelectedNodes() {
    const targets = nodes.filter((node) => selectedGrowIds.includes(node.id));
    if (!targets.length || isGrowing) return;
    setIsGrowing(true);
    setGrowthError("");
    try {
      for (const target of targets) {
        await executeGrowth(target);
      }
      setSelectedGrowIds([]);
      setRequest(`批量生长完成 · ${targets.length} 个节点 · 每个生成 ${growthCount} 个候选`);
    } catch (error) {
      setGrowthError(error instanceof Error ? error.message : "批量生长失败");
    } finally {
      setIsGrowing(false);
    }
  }

  async function refreshRelationCandidates() {
    const edge = edges.find((item) => item.id === editingEdgeId);
    if (!edge || isLoadingRelations) return;
    relationLoadRef.current = loadRelationCandidates(edge.source, edge.target, edge.id);
  }

  function startRelation(node: Node) {
    relationLoadTokenRef.current += 1;
    relationLoadRef.current = null;
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
    const pendingRelationLoad = relationLoadRef.current;
    if (pendingRelationLoad) {
      try { await pendingRelationLoad; } catch { /* 加载函数内部已处理错误 */ }
      relationLoadRef.current = null;
    }
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
      if (workflowThreadIdRef.current) await resumeWorkflow(operations, workflowThreadIdRef.current);
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
    relationLoadTokenRef.current += 1;
    relationLoadRef.current = null;
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
      const saved = await saveStory(projectId, { graphRevision: workflow.graphRevision, content: concept });
      setTraceId(`story-v${saved.version}`);
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
          {[["projects", "00", "项目库"], ["brief", "01", "输入 Brief"], ["graph", "02", "构建图谱"], ["output", "03", "剧情输出"]].map(([key, num, label]) => (
            <button key={key} className={stage === key ? "step active" : "step"} onClick={() => { setStage(key as typeof stage); if (key === "projects") void loadProjects(); }}><b>{num}</b>{label}</button>
          ))}
        </div>
        <div className="system-pill"><span /> DeepSeek · 4 Agents · rev {revision}</div>
      </header>

      {stage === "projects" && <section className="brief-page">
        <div className="hero-copy">
          <p className="eyebrow">PROJECT LIBRARY</p>
          <h1>从项目库开始，<br/><em>继续你的创意</em></h1>
          <p className="lead">打开已有项目继续创作，或新建一个项目开始新的创意发散。图谱和剧情都由服务端保存。</p>
          <div className="principles"><span>{projectList.length} 个项目</span><span>服务端持久化</span><span>可追溯创作</span></div>
        </div>
        <div className="brief-card">
          <div className="card-heading"><div><small>PROJECTS</small><h2>项目库</h2></div><button type="button" className="add-idea" onClick={beginNewProject}>＋ 新建项目</button></div>
          {projectsError && <p className="generation-error">{projectsError}</p>}
          {projectsLoading && <p className="microcopy">正在加载项目…</p>}
          {!projectsLoading && !projectList.length && <p className="microcopy">还没有项目，点击右上角“新建项目”开始第一次创作。</p>}
          {projectList.map((item) => (
            <div key={item.id} style={{ borderBottom: "1px solid var(--line)", padding: "16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div>
                {renamingId === item.id ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} style={{ width: 220 }} />
                    <button className="secondary" onClick={saveRename}>保存</button>
                    <button className="secondary" onClick={() => setRenamingId(null)}>取消</button>
                  </div>
                ) : <><strong>{item.name || "未命名项目"}</strong><small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>revision {item.graphRevision} · 更新于 {new Date(item.updatedAt).toLocaleString()}</small></>}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                <button className="secondary" onClick={() => openProjectFromList(item.id)}>打开</button>
                <button className="secondary" onClick={() => startRename(item.id, item.name)}>重命名</button>
                <button className="secondary" disabled={deletingId === item.id} onClick={() => removeProjectFromList(item.id)}>{deletingId === item.id ? "删除中…" : "删除"}</button>
              </div>
            </div>
          ))}
        </div>
      </section>}

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

      {stage === "graph" && <section className="graph-page prototype-graph">
        <div className="graph-toolbar">
          <div className="toolbar-left">
            <button className="tool-button" onClick={() => setStage("brief")}>← 修改 Brief</button>
            <span className="toolbar-divider" />
            <input className="node-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索节点" />
            <select className="edge-filter" value={edgeMode} onChange={(event) => setEdgeMode(event.target.value as "all" | "hierarchy" | "semantic")}>
              <option value="all">显示全部关系</option>
              <option value="hierarchy">只看生长层级</option>
              <option value="semantic">只看语义关系</option>
            </select>
            <button className="tool-button" onClick={() => { if (layoutMode === "free") { setLayoutMode("hierarchy"); void autoLayout(); } else { setLayoutMode("free"); } }}>
              {layoutMode === "hierarchy" ? "自由拖拽" : "层级自动布局"}
            </button>
          </div>
          <div className="toolbar-right">
            <span className="readiness"><i /> 已采纳 {adopted.length} 节点 · {adoptedEdges.length} 关系 · 准备度 {readiness}%</span>
            <button className="tool-button" disabled={adoptingAll || !nodes.some((node) => node.status === "candidate")} onClick={() => void adoptAllNodes()}>{adoptingAll ? "采纳中…" : "全部采纳"}</button>
            <button className="tool-button" disabled={!selectedGrowIds.length || isGrowing} onClick={() => void growSelectedNodes()}>选中节点生长 {selectedGrowIds.length}</button>
            <button className="tool-button primary" disabled={!adopted.length || isConverging} onClick={generateOutput}>{isConverging ? "Story Agent 生成中…" : "生成方案 →"}</button>
          </div>
        </div>

        <div className="pipeline-strip">
          <span className="pipeline-kicker">AGENT PIPELINE</span>
          {(agentTrace.length ? agentTrace : [
            { agent: "Supervisor", status: "waiting", summary: "规划发散路线" },
            { agent: "Creative", status: "waiting", summary: "生成候选节点" },
            { agent: "Critic", status: "waiting", summary: "审查修复与偏题" },
            { agent: "Story", status: "waiting", summary: "检查收敛就绪度" },
          ] as AgentTrace[]).map((item, index) => (
            <span key={item.agent} className={`pipeline-chip ${item.status}`} title={item.summary}><b>{index + 1}</b>{item.agent}<small>{item.summary}</small></span>
          ))}
          <span className="pipeline-rev">rev {revision}</span>
          <span className="pipeline-req" title={request}>{request}</span>
        </div>

        {convergeError && <p className="graph-error">{convergeError}</p>}

        <div className="graph-layout">
          <div
            className={`graph-canvas ${relationSource ? "relation-mode" : ""} ${dragState ? "dragging" : ""} ${spacePressed ? "space-pan" : ""} ${panning ? "panning" : ""}`}
            role="button"
            tabIndex={0}
            onPointerDown={(event) => startCanvasPan(event)}
            onPointerMove={(event) => moveCanvasPan(event)}
            onPointerUp={(event) => endCanvasPan(event)}
            onPointerCancel={() => endCanvasPan()}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const px = event.clientX - rect.left;
              const py = event.clientY - rect.top;
              setPointer({ x: px, y: py });
              if (dragState) {
                if (movedRef.current || Math.hypot(px - pointer.x, py - pointer.y) > 0.5) movedRef.current = true;
                const nx = px - dragState.offsetX;
                const ny = py - dragState.offsetY;
                updateDraggedPosition(dragState.id, nx, ny);
              }
            }}
            onMouseUp={() => { void finishDrag(); }}
            onMouseLeave={() => { void finishDrag(); }}
            onClick={() => { if ((relationSource || editingEdgeId) && !movedRef.current) cancelDraftRelation(); }}
            onKeyDown={(event) => { if (event.key === "Escape") cancelDraftRelation(); }}
          >
            <div className="canvas-hint">
              <span>可拖拽画布</span>
              <small>拖动节点调整位置，点击连接点建立关系</small>
            </div>
            <div className="graph-layer" style={{ transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0)` }}>
            <div
              className="source-node"
              style={{ left: sourceNodePos.x, top: sourceNodePos.y, transform: "none" }}
              onPointerDown={(event) => startNodeDrag(event, "system-source")}
              onPointerMove={(event) => moveNodeDrag(event, "system-source")}
              onPointerUp={(event) => endNodeDrag(event, "system-source")}
              onPointerCancel={() => { if (dragState?.id === "system-source") void finishDrag(); }}
            >
              <span>推广目标</span><strong>{product}</strong>
            </div>
            <svg className="edge-layer">
              <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
              {edgeMode !== "semantic" && Object.entries(categoryMeta).map(([key]) => {
                const category = key as Category;
                const categoryCenter = { x: categoryNodePos[category].x + 48, y: categoryNodePos[category].y + 48 };
                return <line key={`h-source-${key}`} x1={sourceNodePos.x + 59} y1={sourceNodePos.y + 59} x2={categoryCenter.x} y2={categoryCenter.y} className="hierarchy-line" />;
              })}
              {edgeMode !== "semantic" && visibleHierarchyEdges.map((edge) => {
                const target = nodes.find((n) => n.id === edge.targetId);
                const p = edge.sourceId.startsWith("system-category-")
                  ? { x: categoryNodePos[edge.sourceId.replace("system-category-", "") as Category].x + 48, y: categoryNodePos[edge.sourceId.replace("system-category-", "") as Category].y + 48 }
                  : nodes.find((n) => n.id === edge.sourceId);
                return p && target ? <line key={edge.id} x1={p.x} y1={p.y} x2={target.x + 44} y2={target.y + 44} className="hierarchy-line" /> : null;
              })}
              {edgeMode !== "hierarchy" && visibleSemanticEdges.map((edge) => { const points = semanticEdgePoints(edge); return points ? <line key={edge.id} x1={points.x1} y1={points.y1} x2={points.x2} y2={points.y2} className={`semantic-line ${editingEdgeId === edge.id ? "highlighted" : ""}`} markerEnd={edge.direction !== "reverse" ? "url(#arrow)" : undefined} markerStart={edge.direction !== "forward" ? "url(#arrow)" : undefined} /> : null; })}
              {relationSource && !editingEdgeId && (() => { const point = relationDraftPoint(relationSource, pointer.x - panOffset.x, pointer.y - panOffset.y); return point ? <line x1={point.x1} y1={point.y1} x2={pointer.x - panOffset.x} y2={pointer.y - panOffset.y} className="draft-relation-line" /> : null; })()}
            </svg>

            {edgeMode !== "hierarchy" && visibleSemanticEdges.map((edge) => { const points = semanticEdgePoints(edge); return points ? <button key={`label-${edge.id}`} className={`edge-label ${editingEdgeId === edge.id ? "active" : ""}`} style={{ left: (points.x1 + points.x2) / 2, top: (points.y1 + points.y2) / 2 - 8 }} onClick={(event) => { event.stopPropagation(); setEditingEdgeId(edge.id); setRelationSource(edge.source); setDraftRelation({ label: edge.label, direction: edge.direction || "forward" }); }}>{edge.label}</button> : null; })}
            {Object.entries(categoryMeta).map(([key, meta]) => {
              const category = key as Category;
              const pos = categoryNodePos[category];
              return (
                <div
                  key={key}
                  className={`category-node ${key}`}
                  style={{ left: pos.x, top: pos.y }}
                  onPointerDown={(event) => startNodeDrag(event, `system-category-${category}`)}
                  onPointerMove={(event) => moveNodeDrag(event, `system-category-${category}`)}
                  onPointerUp={(event) => endNodeDrag(event, `system-category-${category}`)}
                  onPointerCancel={() => { if (dragState?.id === `system-category-${category}`) void finishDrag(); }}
                >
                  {meta.label}
                </div>
              );
            })}
            {visibleNodes.map((node) => (
              <div key={node.id} role="button" tabIndex={0}
                onClick={(event) => { event.stopPropagation(); if (!movedRef.current) nodeClick(node); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") nodeClick(node); }}
                onPointerDown={(event) => startNodeDrag(event, node.id)}
                onPointerMove={(event) => moveNodeDrag(event, node.id)}
                onPointerUp={(event) => endNodeDrag(event, node.id)}
                onPointerCancel={() => { if (dragState?.id === node.id) void finishDrag(); }}
                className={`graph-node creative ${node.category} ${node.status} ${selectedId === node.id ? "selected" : ""} ${relationSource === node.id ? "connecting" : ""} ${relationSource && relationSource !== node.id ? "relation-target" : ""}`}
                style={{ left: node.x, top: node.y, "--node-size": "88px" } as CSSProperties}
                title={node.description}
              >
                <strong className="node-title">{node.title}</strong>
                <span className="node-status-icon">{node.status === "adopted" ? "✓" : node.status === "excluded" ? "×" : node.status === "needs_review" ? "!" : "·"}</span>
                <button type="button" className="node-connector" title="建立关系" onPointerDown={(event) => { if (spacePressedRef.current) return; event.stopPropagation(); }} onMouseDown={(event) => { if (spacePressedRef.current) return; event.stopPropagation(); }} onClick={(event) => { if (spacePressedRef.current) return; event.stopPropagation(); startRelation(node); }} />
                <div className="node-quick-actions">
                  <label><input type="checkbox" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} checked={selectedGrowIds.includes(node.id)} onChange={() => toggleGrowSelection(node.id)} /> 生长</label>
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={() => setSelectedId(node.id)}>详情</button>
                </div>
                {node.growthMode && <span className="growth-badge">生长候选</span>}
                {selectedId === node.id && !relationSource && <button className="node-grow" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openGrowth(node); }}>+ 生成候选</button>}
              </div>
            ))}
            {!visibleNodes.length && <div className="empty-graph"><span>?</span><p>没有匹配的节点</p></div>}
            {relationSource && <div className="relation-tip">点击另一个内容节点建立关系 · Esc 取消</div>}
            {editingEdgeId && (() => { const edge = edges.find((item) => item.id === editingEdgeId); const a = nodes.find((n) => n.id === edge?.source); const b = nodes.find((n) => n.id === edge?.target); return edge && a && b ? (
              /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 关系编辑浮层阻止画布冒泡并支持 Esc 取消 */
              <div className="relation-editor" role="dialog" aria-label="编辑语义关系" style={{ left: (a.x + b.x) / 2 + 44, top: (a.y + b.y) / 2 + 58 }} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") cancelDraftRelation(); }}>
                <strong>编辑语义关系</strong>
                {isLoadingRelations ? <div className="relation-loading">Creative Agent 生成关系候选…</div> : relationCandidates.length ? (
                  <div className="candidate-relations">{relationCandidates.map((candidate) => <button key={candidate.label} className={draftRelation.label === candidate.label ? "active" : ""} title={candidate.rationale} onClick={() => setDraftRelation({ label: candidate.label, direction: candidate.direction })}>{candidate.label}</button>)}</div>
                ) : (
                  <div className="candidate-relations"><button onClick={() => setDraftRelation((value) => ({ ...value, label: "推动剧情发展" }))}>推动剧情发展</button><button onClick={() => setDraftRelation((value) => ({ ...value, label: "形成障碍冲突" }))}>形成障碍冲突</button><button onClick={() => setDraftRelation((value) => ({ ...value, label: "构成反转" }))}>构成反转</button></div>
                )}
                <div className="relation-toolbar"><button disabled={isLoadingRelations} onClick={() => void refreshRelationCandidates()}>换一批</button></div>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus -- 打开编辑器时聚焦输入，便于快速输入 */}
                <input value={draftRelation.label} onChange={(event) => setDraftRelation((value) => ({ ...value, label: event.target.value }))} placeholder="输入关系" autoFocus />
                <div className="relation-direction"><button className={draftRelation.direction === "forward" ? "active" : ""} onClick={() => setDraftRelation((value) => ({ ...value, direction: "forward" }))}>源 → 目标</button><button className={draftRelation.direction === "reverse" ? "active" : ""} onClick={() => setDraftRelation((value) => ({ ...value, direction: "reverse" }))}>目标 → 源</button><button className={draftRelation.direction === "both" ? "active" : ""} onClick={() => setDraftRelation((value) => ({ ...value, direction: "both" }))}>双向</button></div>
                {relationError && <p>{relationError}</p>}
                <div className="editor-actions"><button onClick={cancelDraftRelation}>取消</button><button className="confirm" onClick={saveRelation}>确认关系</button></div>
              </div>
            ) : null; })()}
            </div>
          </div>

          <aside className="inspector">
            {!selected && <div className="inspector-empty">
              <div className="empty-orbit">?</div>
              <h2>选择一个内容节点</h2>
              <p>在右侧编辑属性、调整方向、建立语义关系和生长分支。</p>
              <button className="tool-button primary" onClick={() => void addManualNode()}>手动新增节点</button>
            </div>}
            {selected && <>
              <div className="inspector-header">
                <div><span className="inspector-kicker">{categoryMeta[selected.category].label}</span><h2>{selected.title}</h2></div>
                <span className={`status-tag ${selected.status}`}>{statusLabel(selected.status)}</span>
              </div>
              <div className="edit-form">
                <label>标题<input value={selected.title} onChange={(event) => updateNodeLocal(selected.id, { title: event.target.value })} /></label>
                <label>描述<textarea value={selected.description} onChange={(event) => updateNodeLocal(selected.id, { description: event.target.value })} /></label>
                <label>子类型<input value={selected.subtype || ""} onChange={(event) => updateNodeLocal(selected.id, { subtype: event.target.value })} placeholder="如：道具、角色、冲突" /></label>
              </div>
              {selected.status === "needs_review" && (
                <div className="needs-review-banner"><strong>该节点被 AI 修改后进入复核</strong><p>请复核后确认采纳，确保不偏离全局约束。</p><button className="confirm" onClick={() => confirmNeedsReview(selected.id)}>确认已采纳</button></div>
              )}
              <div className="panel-section">
                <div className="panel-title"><strong>节点信息</strong></div>
                <dl>
                  <div><dt>来源</dt><dd>{selected.provenance}</dd></div>
                  <div><dt>层级</dt><dd>{selected.depth ?? 1}{selected.originalDepth && selected.originalDepth !== selected.depth ? `（原 ${selected.originalDepth}）` : ""}</dd></div>
                  <div><dt>重要性</dt><dd><span className="importance-picker">{[1, 2, 3, 4, 5].map((level) => <button key={level} className={(selected.importance || 3) >= level ? "on" : ""} onClick={() => updateImportance(selected.id, level)} aria-label={`重要性 ${level}`}>★</button>)}</span></dd></div>
                </dl>
              </div>
              <div className="panel-section">
                <div className="panel-title"><strong>推荐属性</strong><button className="text-action" onClick={() => addNodeAttribute(selected.id)}>+ 添加字段</button></div>
                <div className="attribute-rows">
                  {Object.entries(selected.attributes || {}).map(([key, value]) => (
                    <div className="attribute-row" key={key}>
                      <input value={key} disabled />
                      <input value={Array.isArray(value) ? value.join("、") : String(value)} onChange={(event) => updateNodeAttribute(selected.id, key, event.target.value)} />
                      <button type="button" aria-label={`删除 ${key}`} onClick={() => removeNodeAttribute(selected.id, key)}>×</button>
                    </div>
                  ))}
                  {!Object.keys(selected.attributes || {}).length && <p className="empty-copy">暂无推荐属性，可添加自定义字段。</p>}
                </div>
              </div>
              <div className="panel-section">
                <div className="panel-title"><strong>语义关系</strong><button className="text-action" onClick={() => startRelation(selected)}>建立关系</button></div>
                {edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).length ? edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).map((edge) => <span className="relation-chip" key={edge.id}>{edge.label} · {edge.status}</span>) : <p className="empty-copy">尚未建立语义关系。</p>}
              </div>
              <div className="inspector-actions">
                <button onClick={() => updateStatus(selected.id, "adopted")}>采纳</button>
                <button onClick={() => updateStatus(selected.id, "excluded")}>排除</button>
                <button onClick={() => saveEditNode(selected.id)}>保存</button>
                <button onClick={() => openGrowth(selected)}>生长</button>
                <button className="danger" onClick={() => openDeleteConfirm(selected)}>删除</button>
                {selected.status === "excluded" && <button onClick={() => updateStatus(selected.id, "candidate")}>恢复</button>}
              </div>
              {growthOpen && <section className="growth-panel">
                <div className="growth-head"><div><small>GROWTH</small><h4>从「{selected.title}」生长新分支</h4></div><button onClick={() => setGrowthOpen(false)} aria-label="关闭生长面板">×</button></div>
                <div className="anchor-card"><span>推广目标</span><strong>{product}</strong><em>始终携带</em></div>
                <div className={`anchor-card ${narrativeAnchor ? "safe" : "warning"}`}><span>叙事锚点</span><strong>{narrativeAnchor?.title || "尚未确定核心角色"}</strong><em>{narrativeAnchor ? "已锚定" : "建议先采纳角色"}</em></div>
                <p className="growth-label">选择生长方式</p>
                <div className="growth-modes">{growthModes.map((mode) => <button key={mode.id} className={growthMode === mode.id ? "active" : ""} onClick={() => { setGrowthMode(mode.id); if (mode.category) setGrowthCategory(mode.category); }}><strong>{mode.label}</strong><small>{mode.hint}</small></button>)}</div>
                {!growthModes.find((mode) => mode.id === growthMode)?.category && <div className="category-picker"><span>目标类别</span>{(Object.keys(categoryMeta) as Category[]).map((category) => <button key={category} className={growthCategory === category ? "active" : ""} onClick={() => setGrowthCategory(category)}>{categoryMeta[category].label}</button>)}</div>}
                <label className="growth-instruction">生长要求（可选）<textarea value={growthInstruction} onChange={(event) => setGrowthInstruction(event.target.value)} placeholder="例如：围绕玩梗制造荒诞感，不要重复现有节点" /></label>
                <div className="growth-footer"><div><span>候选数量</span><button disabled={isGrowing} className={growthCount === 2 ? "active" : ""} onClick={() => setGrowthCount(2)}>2</button><button disabled={isGrowing} className={growthCount === 3 ? "active" : ""} onClick={() => setGrowthCount(3)}>3</button></div><button disabled={isGrowing} className="generate-growth" onClick={() => executeGrowth(selected)}>{isGrowing ? "Agent 生成中…" : "生成候选 →"}</button></div>
                {growthError && <p className="growth-error">{growthError}</p>}
              </section>}
            </>}
          </aside>
        </div>

        {deleteConfirm && <div className="delete-modal-backdrop" role="presentation" onClick={() => setDeleteConfirm(null)}>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- 弹窗容器阻止冒泡 */}
          <div className="delete-modal" role="dialog" aria-label="删除节点确认" onClick={(event) => event.stopPropagation()}>
            <strong>删除「{deleteConfirm.nodeTitle}」？</strong>
            {deleteConfirm.descendantCount > 0 && <p>该节点还有 {deleteConfirm.descendantCount} 个后代节点。</p>}
            <div className="editor-actions">
              <button onClick={() => setDeleteConfirm(null)}>取消</button>
              <button onClick={() => deleteNodeOnly(deleteConfirm.nodeId)}>仅删除当前节点{deleteConfirm.descendantCount > 0 ? "（后代自动上提）" : ""}</button>
              {deleteConfirm.descendantCount > 0 && <button className="danger" onClick={() => deleteCascade(deleteConfirm.nodeId)}>级联删除（共 {deleteConfirm.descendantCount + 1} 个节点）</button>}
            </div>
          </div>
        </div>}
      </section>}


      {stage === "output" && <section className="output-page">
        <div className="output-intro"><p className="eyebrow">TRACEABLE STORY OUTPUT</p><h1>每一个剧情节拍，<br/>都有图谱依据。</h1><p>系统只读取已采用子图；未采用和已排除节点不会进入最终生成上下文。</p><div className="head-actions output-actions" style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 18 }}><button className="secondary" onClick={exportStoryMarkdown}>导出 Markdown</button><button className="secondary" onClick={exportStoryCsv}>导出分镜 CSV</button><button className="secondary" onClick={copyStoryText}>{exportNotice || "复制全文"}</button><button className="secondary" onClick={() => setStage("graph")}>← 返回图谱调整</button></div></div>
        {convergeError && <p className="generation-error">{convergeError}</p>}
        <div className="story-card">
          <div className="story-head"><div><small>ONE-LINE CONCEPT</small>{storyConcept ? <input value={storyConcept.concept} onChange={(event) => updateStoryField("concept", event.target.value)} style={{ width: "100%", font: "inherit", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", background: "white" }} /> : <h2>每个人都有十秒钟，成为水世界国王。</h2>}</div><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>{traceId || "story-draft"}</span><button className="secondary" disabled={!storyConcept} onClick={saveStoryVersion}>保存版本</button></div></div>
          {storyConcept && <div className="story-meta"><div><small>核心主题</small><input value={storyConcept.theme} onChange={(event) => updateStoryField("theme", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "white", fontSize: 12 }} /></div><div><small>叙事视角</small><input value={storyConcept.perspective} onChange={(event) => updateStoryField("perspective", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "white", fontSize: 12 }} /></div><div><small>故事主线</small><input value={storyConcept.main_line} onChange={(event) => updateStoryField("main_line", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "white", fontSize: 12 }} /></div></div>}
          <div className="concept-grid">
            <div><small>核心冲突</small>{storyConcept ? <input value={storyConcept.core_conflict} onChange={(event) => updateStoryField("core_conflict", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "white", fontSize: 12 }} /> : <strong>现任国王抵挡全场挑战者</strong>}</div>
            <div><small>卖点植入</small>{storyConcept ? <input value={storyConcept.selling_point_insertion} onChange={(event) => updateStoryField("selling_point_insertion", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "white", fontSize: 12 }} /> : <strong>水枪玩法即剧情机制</strong>}</div>
            <div><small>记忆点</small>{storyConcept ? <input value={storyConcept.twist} onChange={(event) => updateStoryField("twist", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "white", fontSize: 12 }} /> : <strong>透明王冠最后一秒换人</strong>}</div>
          </div>
          <div className="beats">{(storyConcept?.beats?.length ? storyConcept.beats : story).map((beat, index) => <article key={beat.phase + index}><b>{String(index + 1).padStart(2,"0")}</b><div>{storyConcept ? <><input value={beat.phase} onChange={(event) => updateBeat(index, { phase: event.target.value })} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "white", fontSize: 11 }} /><textarea rows={2} value={beat.text} onChange={(event) => updateBeat(index, { text: event.target.value })} style={{ width: "100%", marginTop: 6, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "white", fontSize: 12 }} /></> : <><small>{beat.phase}</small><p>{beat.text}</p></>}<div className="refs">{beat.refs.map((ref) => <span key={ref}>↗ {nodes.find((n) => n.id === ref)?.title || ref}</span>)}{!beat.refs.length && <span>Brief 约束</span>}</div></div></article>)}</div>
          {storyConcept?.shooting_feasibility && <div className="shooting-note"><small>拍摄可行性</small><textarea rows={2} value={storyConcept.shooting_feasibility} onChange={(event) => updateStoryField("shooting_feasibility", event.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "white", fontSize: 12 }} /></div>}
          {storyConcept?.cta && <div className="shooting-note"><small>CTA</small><input value={storyConcept.cta} onChange={(event) => updateStoryField("cta", event.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "white", fontSize: 12 }} /></div>}
          <div className="validation-bar"><span>✓ Schema</span><span>✓ 节点引用</span><span>✓ {durationSeconds} 秒时长</span><span>✓ 禁用内容</span><strong>{isConverging ? "Story Agent 生成中…" : "validation passed"}</strong></div>
          <div className="ai-panel" style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><strong>AI 微调助手</strong><small style={{ color: "var(--muted)" }}>修改前先给差异预览，不直接覆盖正式版本</small></div>
            <div className="quick-prompts" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
              {["节奏更快", "反转更强", "卖点更自然", "降低拍摄成本"].map((prompt) => <button key={prompt} className="secondary" style={{ padding: "4px 8px", fontSize: 9 }} onClick={() => setAiPrompt(prompt)}>{prompt}</button>)}
            </div>
            <textarea rows={3} value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="例如：让前 3 秒冲突更强，但不要增加拍摄角色" style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "white", fontSize: 12 }} />
            <button className="primary compact" style={{ marginTop: 8 }} disabled={!storyConcept || !aiPrompt.trim() || aiLoading} onClick={() => void generateAiDiff()}>{aiLoading ? "生成中…" : "生成修改建议"}</button>
            {aiError && <p style={{ color: "#a63e2c", fontSize: 10, marginTop: 8 }}>{aiError}</p>}
            {aiDiff && <div className="diff-preview" style={{ marginTop: 12, border: "1px solid var(--line)", padding: 10, background: "#f7f4ee" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>差异预览</strong><span style={{ color: "var(--muted)", fontSize: 9 }}>未应用</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <div><span style={{ fontSize: 9, color: "var(--muted)" }}>修改前</span><pre style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>{JSON.stringify(aiDiff.before, null, 2)}</pre></div>
                <div><span style={{ fontSize: 9, color: "var(--muted)" }}>修改后</span><pre style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>{JSON.stringify(aiDiff.after, null, 2)}</pre></div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button className="secondary" onClick={() => setAiDiff(null)}>拒绝</button><button className="secondary" onClick={() => applyAiDiff(false)}>部分接受</button><button className="primary compact" onClick={() => applyAiDiff(true)}>全部接受</button></div>
            </div>}
          </div>
        </div>
        <aside className="output-side"><div><small>来源图谱</small><strong>revision {revision}</strong></div><div><small>已采用节点</small><strong>{adopted.length}</strong></div><div><small>已采用关系</small><strong>{adoptedEdges.length}</strong></div><div><small>生成方式</small><strong>{storyConcept ? "Story Agent" : "前端模板"}</strong></div><p>输出保存为新版本，不覆盖此前剧情。用户可按节拍局部修改并选择性接受。</p></aside>
      </section>}
    </main>
  );
}
