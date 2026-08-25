import { callDeepSeekJson } from "../../../../lib/agents/deepseek";
import { getRequestId, okJson, readJsonObject, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getRuntimeEnv } from "../../../../lib/runtime/env";

type OptimizationResult = { before: string; after: string; explanation?: string };

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await readJsonObject(request);
    const instruction = String(body.instruction ?? "").trim();
    const story = body.story as Record<string, unknown> | undefined;
    if (!instruction || !story) throw new Error("剧情和优化要求不能为空");
    const before = String(story.concept ?? "");
    const env = await getRuntimeEnv();
    if (String(env.CREATIVE_MODEL_PROVIDER ?? "deepseek").toLowerCase() === "mock") {
      return okJson({ before, after: `${before} 开场前三秒直接建立冲突，并在结尾自然落到产品行动。`, explanation: `已按“${instruction}”进行局部优化。` }, {}, requestId);
    }
    const result = await callDeepSeekJson<OptimizationResult>([
      { role: "system", content: "你是短视频广告 Story Agent 与 Critic。根据修改要求只优化一句话创意，保持事实、已采用节点和产品约束不变。只返回 JSON：{before,after,explanation}。" },
      { role: "user", content: JSON.stringify({ instruction, story, brief: body.brief }) },
    ]);
    return okJson({ before: result.before || before, after: result.after, explanation: result.explanation }, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.CONCEPT_FAILED, 502, requestId);
  }
}
