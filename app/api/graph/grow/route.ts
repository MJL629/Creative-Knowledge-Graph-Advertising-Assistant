import { getCreativeAgentGateway } from "../../../../lib/agents/creative-agent-gateway";
import type { GrowthRequest } from "../../../../lib/agents/growth-pipeline";
import { getRequestId, okJson, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getRuntimeEnv } from "../../../../lib/runtime/env";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const runtimeEnv = await getRuntimeEnv() as { OPENAI_TIMEOUT_MS?: string; DEEPSEEK_TIMEOUT_MS?: string };
  const timeoutMs = Number(runtimeEnv.OPENAI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? runtimeEnv.DEEPSEEK_TIMEOUT_MS ?? process.env.DEEPSEEK_TIMEOUT_MS ?? 60000) * 6;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = await request.json() as GrowthRequest;
    const result = await getCreativeAgentGateway().growNode(body, { graphRevision: body.graphRevision, requestId }, controller.signal);
    return okJson(result, {}, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const isInputError = ["不存在", "不能", "非法", "只能", "循环", "祖先", "三层"].some((word) => message.includes(word));
    return routeError(error, isInputError ? ERROR_CODES.GROWTH_INPUT_INVALID : ERROR_CODES.GRAPH_GROWTH_FAILED, isInputError ? 400 : 502, requestId);
  } finally {
    clearTimeout(timer);
  }
}
