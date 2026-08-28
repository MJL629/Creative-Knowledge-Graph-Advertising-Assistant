import caseSkillResource from "../../python_agents/src/creative_graph_agents/skills/creative-case-patterns/references/cases.json";
import { getRuntimeEnv } from "../runtime/env";
import { callDeepSeekJson, type ChatMessage } from "./deepseek";

type CaseSkillStage = "initial" | "growth";

type CaseSkillCard = {
  skill_id: string;
  title: string;
  description: string;
  triggers: string[];
  stages: CaseSkillStage[];
  example: Record<string, unknown>;
};

export type SelectedCaseSkill = {
  skillId: string;
  title: string;
  reason: string;
  stages: CaseSkillStage[];
  example: Record<string, unknown>;
};

export type CaseSkillContext = {
  catalogVersion: string;
  selectionMode: "auto" | "disabled";
  selected: SelectedCaseSkill[];
  warning?: string;
};

type CaseSkillModelCall = (
  messages: ChatMessage[],
  signal?: AbortSignal,
) => Promise<{ selected_skills?: Array<{ skill_id?: string; reason?: string }> }>;

const MAX_SELECTED_SKILLS = 2;
const cards = caseSkillResource.skills as CaseSkillCard[];

export function getCaseSkillCatalog(stage: CaseSkillStage) {
  return cards
    .filter((card) => card.stages.includes(stage))
    .map((card) => ({
      skill_id: card.skill_id,
      title: card.title,
      description: card.description,
      triggers: [...card.triggers],
      stages: [...card.stages],
    }));
}

function emptyContext(
  selectionMode: "auto" | "disabled",
  warning?: string,
): CaseSkillContext {
  return {
    catalogVersion: caseSkillResource.catalog_version,
    selectionMode,
    selected: [],
    ...(warning ? { warning } : {}),
  };
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return signal?.aborted
    || (error instanceof Error && error.name === "AbortError");
}

export function resolveCaseSkillSelection(
  rawSelection: unknown,
  stage: CaseSkillStage,
): CaseSkillContext {
  const context = emptyContext("auto");
  if (!rawSelection || typeof rawSelection !== "object") return context;
  const requested = (rawSelection as { selected_skills?: unknown }).selected_skills;
  if (!Array.isArray(requested)) return context;

  const allowed = new Map(cards
    .filter((card) => card.stages.includes(stage))
    .map((card) => [card.skill_id, card]));
  const seen = new Set<string>();
  for (const item of requested) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const skillId = String(record.skill_id ?? "").trim();
    const card = allowed.get(skillId);
    if (!card || seen.has(skillId)) continue;
    seen.add(skillId);
    context.selected.push({
      skillId,
      title: card.title,
      reason: String(record.reason ?? "").trim(),
      stages: [...card.stages],
      example: structuredClone(card.example),
    });
    if (context.selected.length >= MAX_SELECTED_SKILLS) break;
  }
  return context;
}

export async function selectCreativeCaseSkills(
  input: {
    stage: CaseSkillStage;
    brief: unknown;
    taskContext?: Record<string, unknown>;
  },
  signal?: AbortSignal,
  modelCall: CaseSkillModelCall = callDeepSeekJson,
): Promise<CaseSkillContext> {
  const env = await getRuntimeEnv();
  const mode = String(env.CREATIVE_CASE_SKILL_MODE ?? "auto").trim().toLowerCase();
  if (mode === "disabled") return emptyContext("disabled");

  try {
    const result = await modelCall([
      {
        role: "system",
        content: [
          "你是 Creative Case Skill Selector，只选择案例模式，不生成创意节点。",
          "必须只输出合法 JSON。最多选择两个互补模式；只能使用目录中的 skill_id。",
          "依据品类、平台、受众、Hook、叙事机制和当前任务选择，而不是只看表面词语。",
          "案例是 Few-shot 结构参考，不是事实来源；没有合适案例时返回空数组。",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "select_creative_case_skills",
          stage: input.stage,
          brief: input.brief,
          task_context: input.taskContext ?? {},
          skill_catalog: getCaseSkillCatalog(input.stage),
          selection_limit: MAX_SELECTED_SKILLS,
          required_json: {
            selected_skills: [{ skill_id: "catalog skill_id", reason: "selection reason" }],
          },
        }),
      },
    ], signal);
    return resolveCaseSkillSelection(result, input.stage);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return emptyContext("auto", "案例技能选择暂不可用，已跳过案例参考");
  }
}

export const CASE_SKILL_USAGE_RULES = [
  "case_skill_context 只是可选 Few-shot 模式，不是当前故事事实",
  "只能迁移 Hook、冲突、结构、卖点植入和 CTA 等抽象机制",
  "不得复制案例产品、人物、道具、句子或未经 Brief 确认的事实",
  "Brief、主体契约、硬约束和 adopted 图谱事实优先",
];
