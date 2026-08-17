import { env } from "cloudflare:workers";
import { callMockJson, type ChatMessage as MockMessage } from "./mock-llm";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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
};

/**
 * 统一 LLM 入口：根据 CREATIVE_MODEL_PROVIDER 切 mock / deepseek。
 * - mock：不调用真实 API，返回固定候选，无 Key 时也能跑通完整演示（PRD 9.1）
 * - deepseek（默认）：调用真实 DeepSeek API
 */
export async function callDeepSeekJson<T>(messages: ChatMessage[], signal?: AbortSignal): Promise<T> {
  const runtimeEnv = env as DeepSeekEnvironment;
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

  const response = await fetch(`${baseUrl}/chat/completions`, {
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

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek 请求失败 (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 返回了空内容");

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error("DeepSeek 返回内容不是合法 JSON");
  }
}
