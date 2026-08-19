import { AppError, ERROR_CODES } from "../contracts/errors";

export function getRequestId(request?: Request): string {
  return request?.headers.get("x-request-id") || crypto.randomUUID();
}

export function okJson(result: unknown, init: ResponseInit = {}, requestId?: string) {
  const headers = new Headers(init.headers);
  if (requestId) headers.set("x-request-id", requestId);
  return Response.json({ ok: true, result }, { ...init, headers });
}

export function errorJson(code: string, message: string, status = 500, details?: Record<string, unknown>, requestId?: string) {
  const headers = new Headers();
  if (requestId) headers.set("x-request-id", requestId);
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status, headers },
  );
}

export function routeError(error: unknown, fallbackCode: string = ERROR_CODES.INTERNAL_ERROR, fallbackStatus = 500, requestId?: string) {
  if (error instanceof AppError) {
    return errorJson(error.code, error.message, error.status, error.details, requestId);
  }

  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return errorJson(ERROR_CODES.PROVIDER_TIMEOUT, "External provider timed out", 504, undefined, requestId);
  }

  const message = error instanceof Error ? error.message : "Internal error";
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return errorJson(ERROR_CODES.PROVIDER_TIMEOUT, "External provider timed out", 504, undefined, requestId);
  }
  return errorJson(fallbackCode, message, fallbackStatus, undefined, requestId);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Request body must be a JSON object", 400);
  }
  return body as Record<string, unknown>;
}
