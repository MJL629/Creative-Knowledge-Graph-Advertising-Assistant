import { env } from "cloudflare:workers";
import { runStoryConvergePipeline, type StoryConceptRequest } from "../../../../lib/agents/graph-pipeline";

export async function POST(request: Request) {
  const runtimeEnv = env as { OPENAI_TIMEOUT_MS?: string; DEEPSEEK_TIMEOUT_MS?: string };
  const timeoutMs = Number(runtimeEnv.OPENAI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? runtimeEnv.DEEPSEEK_TIMEOUT_MS ?? process.env.DEEPSEEK_TIMEOUT_MS ?? 60000) * 6;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = await request.json() as StoryConceptRequest;
    const result = await runStoryConvergePipeline(body, controller.signal);
    return Response.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const isInputError = ["不能为空", "不能", "至少需要"].some((word) => message.includes(word));
    return Response.json({ ok: false, error: { code: isInputError ? "CONCEPT_INPUT_INVALID" : "CONCEPT_FAILED", message } }, { status: isInputError ? 400 : 502 });
  } finally {
    clearTimeout(timer);
  }
}
