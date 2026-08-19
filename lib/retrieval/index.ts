import { AppError, ERROR_CODES, type RetrievalProvider } from "../contracts";
import { getRuntimeEnv, type RuntimeEnvironment } from "../runtime/env";
import { MockRetrievalProvider } from "./mock-retrieval-provider";

const mockRetrievalProvider = new MockRetrievalProvider();
type RealRetrievalFactory = (env: RuntimeEnvironment) => RetrievalProvider | Promise<RetrievalProvider>;
let realRetrievalFactory: RealRetrievalFactory | undefined;

export function registerRealRetrievalProvider(factory: RealRetrievalFactory) {
  realRetrievalFactory = factory;
}

export async function getRetrievalProvider(): Promise<RetrievalProvider> {
  const env = await getRuntimeEnv();
  const provider = String(env.RETRIEVAL_PROVIDER ?? "mock").toLowerCase();
  if (provider === "mock") return mockRetrievalProvider;
  if (provider === "real" && realRetrievalFactory) return realRetrievalFactory(env);
  throw new AppError(
    ERROR_CODES.INTERNAL_ERROR,
    provider === "real" ? "Real RetrievalProvider is not installed" : `Unsupported RETRIEVAL_PROVIDER: ${provider}`,
    503,
  );
}

export { MockRetrievalProvider };
