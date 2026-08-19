import { getCreativeAgentGateway } from "../../../../lib/agents/creative-agent-gateway";
import type { RelationRequest } from "../../../../lib/agents/graph-pipeline";
import { getRequestId, okJson, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getRuntimeEnv } from "../../../../lib/runtime/env";
import { traceCall } from "../../../../lib/observability/trace";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const runtimeEnv = await getRuntimeEnv() as { OPENAI_TIMEOUT_MS?: string; DEEPSEEK_TIMEOUT_MS?: string };
  const timeoutMs = Number(runtimeEnv.OPENAI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? runtimeEnv.DEEPSEEK_TIMEOUT_MS ?? process.env.DEEPSEEK_TIMEOUT_MS ?? 60000) * 6;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = await request.json() as RelationRequest;
    const result = await traceCall("creative", "relation_suggestion", { requestId }, () =>
      getCreativeAgentGateway().suggestRelations(body, { requestId }, controller.signal));
    return okJson(result, {}, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const isInputError = ["不能为空", "不能", "不能相同", "缺少"].some((word) => message.includes(word));
    return routeError(error, isInputError ? ERROR_CODES.RELATIONS_INPUT_INVALID : ERROR_CODES.RELATIONS_FAILED, isInputError ? 400 : 502, requestId);
  } finally {
    clearTimeout(timer);
  }
}
