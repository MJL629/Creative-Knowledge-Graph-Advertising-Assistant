export type RuntimeEnvironment = Record<string, string | undefined>;

export async function getRuntimeEnv(): Promise<RuntimeEnvironment> {
  const specifier = "cloudflare:workers";
  try {
    const cloudflareRuntime = await import(specifier) as { env?: RuntimeEnvironment };
    // Explicit process variables (CI/E2E/deployment overrides) take priority
    // over values loaded by the local Workers runtime from `.env`.
    return { ...(cloudflareRuntime.env ?? {}), ...process.env };
  } catch {
    return process.env;
  }
}
