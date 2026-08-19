import { AppError, ERROR_CODES, type RetrievalProvider, type RetrievalQuery, type RetrievalResult } from "../contracts";

type HttpRetrievalOptions = {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
};

function isRetrievalResult(value: unknown): value is RetrievalResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.query === "string" && Array.isArray(result.hits) && result.hits.every((hit) => {
    if (!hit || typeof hit !== "object") return false;
    const record = hit as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.content === "string" && typeof record.score === "number";
  });
}

export class HttpRetrievalProvider implements RetrievalProvider {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: HttpRetrievalOptions) {
    if (!options.endpoint.trim()) {
      throw new AppError(ERROR_CODES.RETRIEVAL_UNAVAILABLE, "RETRIEVAL_ENDPOINT is required", 503);
    }
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async retrieve(input: RetrievalQuery, signal?: AbortSignal): Promise<RetrievalResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(input),
        signal: combinedSignal,
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new AppError(
        timedOut ? ERROR_CODES.PROVIDER_TIMEOUT : ERROR_CODES.RETRIEVAL_UNAVAILABLE,
        timedOut ? "Retrieval provider timed out" : "Retrieval provider is unavailable",
        timedOut ? 504 : 503,
      );
    }

    if (!response.ok) {
      throw new AppError(ERROR_CODES.RETRIEVAL_UNAVAILABLE, `Retrieval provider failed (${response.status})`, 502);
    }
    const payload = await response.json() as unknown;
    const result = payload && typeof payload === "object" && "result" in payload
      ? (payload as { result: unknown }).result
      : payload;
    if (!isRetrievalResult(result)) {
      throw new AppError(ERROR_CODES.RETRIEVAL_INVALID_RESPONSE, "Retrieval provider returned an invalid response", 502);
    }
    return result;
  }
}
