import { getRuntimeEnv } from "../runtime/env";
import { callMockJson, type ChatMessage as MockMessage } from "./mock-llm";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function parseModelJson<T>(content: string): T {
  const trimmed = content.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next normalized representation.
    }
  }
  const looksTruncated = (objectStart >= 0 && objectEnd < objectStart) || (arrayStart >= 0 && arrayEnd < arrayStart);
  throw new Error(looksTruncated ? "DeepSeek 返回的 JSON 被截断，请重试或提高 OPENAI_MAX_TOKENS" : "DeepSeek 返回内容不是合法 JSON");
}

type DeepSeekEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_MAX_TOKENS?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_MAX_TOKENS?: string;
  CREATIVE_MODEL_PROVIDER?: string;
  OPENAI_RETRY_MAX?: string;
};

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/**
 * 统一 LLM 入口：根据 CREATIVE_MODEL_PROVIDER 切 mock / deepseek。
 * - mock：不调用真实 API，返回固定候选，无 Key 时也能跑通完整演示（PRD 9.1）
 * - deepseek（默认）：调用真实 DeepSeek API
 */
export async function callDeepSeekJson<T>(messages: ChatMessage[], signal?: AbortSignal): Promise<T> {
  const runtimeEnv = await getRuntimeEnv() as DeepSeekEnvironment;
  const provider = (runtimeEnv.CREATIVE_MODEL_PROVIDER ?? process.env.CREATIVE_MODEL_PROVIDER ?? "deepseek").trim().toLowerCase();

  if (provider === "mock") {
    return callMockJson<T>(messages as MockMessage[]);
  }

  const apiKey = runtimeEnv.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? runtimeEnv.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "replace_with_your_api_key" || apiKey === "replace_with_your_deepseek_api_key") {
    throw new Error("OPENAI_API_KEY 未配置（可在 .env 设置 CREATIVE_MODEL_PROVIDER=mock 以离线运行）");
  }

  const baseUrl = (runtimeEnv.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? runtimeEnv.DEEPSEEK_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = runtimeEnv.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? runtimeEnv.DEEPSEEK_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const maxTokens = Number(runtimeEnv.OPENAI_MAX_TOKENS ?? process.env.OPENAI_MAX_TOKENS ?? runtimeEnv.DEEPSEEK_MAX_TOKENS ?? process.env.DEEPSEEK_MAX_TOKENS ?? 4096);

  const retryMax = Math.max(0, Math.min(Number(runtimeEnv.OPENAI_RETRY_MAX ?? 2), 3));
  let response: Response | undefined;
  for (let attempt = 0; attempt <= retryMax; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || attempt === retryMax) throw error;
      await waitForRetry(150 * (2 ** attempt), signal);
      continue;
    }
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === retryMax) break;
    await response.body?.cancel();
    await waitForRetry(150 * (2 ** attempt), signal);
  }

  if (!response?.ok) {
    const detail = response ? await response.text() : "no response";
    throw new Error(`DeepSeek 请求失败 (${response?.status ?? "network"}): ${detail.slice(0, 300)}`);
  }

  const payload = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new Error("DeepSeek 返回了空内容");
  if (choice?.finish_reason === "length") throw new Error("DeepSeek 返回的 JSON 被截断，请提高 OPENAI_MAX_TOKENS 后重试");
  return parseModelJson<T>(content);
}
