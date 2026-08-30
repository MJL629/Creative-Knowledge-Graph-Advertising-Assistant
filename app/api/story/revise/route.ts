import { callDeepSeekJson } from "../../../../lib/agents/deepseek";
import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getRuntimeEnv } from "../../../../lib/runtime/env";

type ReviseResult = {
  after: unknown;
  changes: Array<{ path: string; before: string; after: string }>;
};

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const runtimeEnv = await getRuntimeEnv() as { OPENAI_TIMEOUT_MS?: string; DEEPSEEK_TIMEOUT_MS?: string };
  const timeoutMs = Number(runtimeEnv.OPENAI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? runtimeEnv.DEEPSEEK_TIMEOUT_MS ?? process.env.DEEPSEEK_TIMEOUT_MS ?? 60000) * 2;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = await readJsonObject(request);
    const instruction = String(body.instruction ?? "").trim();
    const story = body.story;
    if (!instruction) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "instruction is required", 400, undefined, requestId);
    }
    if (!story || typeof story !== "object" || Array.isArray(story)) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "story must be an object", 400, undefined, requestId);
    }

    const result = await callDeepSeekJson<ReviseResult>([
      {
        role: "system",
        content: "你是剧情修改助手。只根据用户指令修改 story 内容，不得修改数据库字段、ID、状态或版本号。必须只返回合法 JSON，不要 Markdown。",
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "story_revise",
          instruction,
          story,
          adopted_nodes: body.adoptedNodes ?? [],
          adopted_edges: body.adoptedEdges ?? [],
          rules: [
            "after 必须是完整的 StoryConcept",
            "changes 只列出真实修改的字段路径与前后值",
            "如果指令不合理，保持 after 与 story 一致并返回空 changes",
          ],
          output: {
            after: "object",
            changes: [{ path: "string", before: "string", after: "string" }],
          },
        }),
      },
    ], controller.signal);

    return okJson({
      before: story,
      after: result.after ?? story,
      changes: Array.isArray(result.changes) ? result.changes : [],
    }, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 502, requestId);
  } finally {
    clearTimeout(timer);
  }
}
