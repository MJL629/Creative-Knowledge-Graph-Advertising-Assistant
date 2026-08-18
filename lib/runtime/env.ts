export type RuntimeEnvironment = Record<string, string | undefined>;

export async function getRuntimeEnv(): Promise<RuntimeEnvironment> {
  const specifier = "cloudflare:workers";
  try {
    const cloudflareRuntime = await import(specifier) as { env?: RuntimeEnvironment };
    return { ...process.env, ...(cloudflareRuntime.env ?? {}) };
  } catch {
    return process.env;
  }
}
