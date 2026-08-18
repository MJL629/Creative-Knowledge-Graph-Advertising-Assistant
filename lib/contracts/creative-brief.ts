export interface CreativeBrief {
  product: string;
  knownFacts?: string[];
  ideaFragments: string[];
  mustKeep?: string[];
  forbidden?: string[];
  constraints?: Record<string, unknown>;

  // Compatibility with the current demo input shape.
  knownInformation?: string;
  mustAvoid?: string[];
  audience?: string;
  platform?: string;
  durationSeconds?: number;
  styles?: string[];
  hotMemes?: string[];
  sellingPoints?: string[];
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value).trim()).filter(Boolean);
}

export function normalizeCreativeBrief(input: unknown): CreativeBrief {
  if (!input || typeof input !== "object") {
    throw new Error("Brief must be an object");
  }

  const raw = input as Record<string, unknown>;
  const product = String(raw.product ?? "").trim();
  const ideaFragments = normalizeStringList(raw.ideaFragments);
  const knownFacts = normalizeStringList(raw.knownFacts);
  const mustKeep = normalizeStringList(raw.mustKeep);
  const forbidden = normalizeStringList(raw.forbidden ?? raw.mustAvoid);

  if (!product) throw new Error("Product is required");
  if (!ideaFragments.length) throw new Error("At least one idea fragment is required");

  return {
    product,
    knownFacts,
    ideaFragments,
    mustKeep,
    forbidden,
    constraints: raw.constraints && typeof raw.constraints === "object" ? raw.constraints as Record<string, unknown> : undefined,
    knownInformation: typeof raw.knownInformation === "string" ? raw.knownInformation.trim() : undefined,
    mustAvoid: normalizeStringList(raw.mustAvoid),
    audience: typeof raw.audience === "string" ? raw.audience.trim() : undefined,
    platform: typeof raw.platform === "string" ? raw.platform.trim() : undefined,
    durationSeconds: typeof raw.durationSeconds === "number" ? raw.durationSeconds : undefined,
    styles: normalizeStringList(raw.styles),
    hotMemes: normalizeStringList(raw.hotMemes),
    sellingPoints: normalizeStringList(raw.sellingPoints),
  };
}
