import { okJson } from "../../../lib/api/response";
import { getRuntimeEnv } from "../../../lib/runtime/env";

export async function GET(request: Request) {
  const runtimeEnv = await getRuntimeEnv() as { CREATIVE_MODEL_PROVIDER?: string };
  return okJson({
    status: "ok",
    modelProvider: runtimeEnv.CREATIVE_MODEL_PROVIDER ?? process.env.CREATIVE_MODEL_PROVIDER ?? "deepseek",
    persistenceProvider: "memory",
  }, {}, request.headers.get("x-request-id") ?? undefined);
}
