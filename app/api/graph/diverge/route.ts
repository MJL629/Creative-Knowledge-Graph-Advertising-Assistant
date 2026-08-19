import { getCreativeAgentGateway } from "../../../../lib/agents/creative-agent-gateway";
import { getRequestId, okJson, routeError } from "../../../../lib/api/response";
import { ERROR_CODES, normalizeCreativeBrief } from "../../../../lib/contracts";
import { getRuntimeEnv } from "../../../../lib/runtime/env";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const runtimeEnv = await getRuntimeEnv() as { OPENAI_TIMEOUT_MS?: string; DEEPSEEK_TIMEOUT_MS?: string };
  const timeoutMs = Number(runtimeEnv.OPENAI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? runtimeEnv.DEEPSEEK_TIMEOUT_MS ?? process.env.DEEPSEEK_TIMEOUT_MS ?? 60000) * 6;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = normalizeCreativeBrief(await request.json());
    const result = await getCreativeAgentGateway().initialDivergence(body, { requestId }, controller.signal);
    return okJson(result, {}, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("不能为空") || message.includes("不能") || message.includes("至少需要") || message === "请求体不能为空" ? 400 : 502;
    return routeError(error, ERROR_CODES.GRAPH_DIVERGENCE_FAILED, status, requestId);
  } finally {
    clearTimeout(timer);
  }
}
