import type { RetrievalProvider, RetrievalQuery, RetrievalResult } from "../contracts";
import type { CreativeCase } from "../knowledge";
import { creativeCaseToRetrievalHit, developmentCreativeCases } from "../knowledge";

const DEFAULT_TOP_K = 3;

const weightedFields: Array<[keyof CreativeCase, number]> = [
  ["title", 5],
  ["tags", 4],
  ["hookType", 4],
  ["productCategory", 3],
  ["platform", 3],
  ["creativeElements", 3],
  ["targetAudience", 2],
  ["summary", 2],
  ["motivationConflict", 2],
  ["storyStructure", 2],
  ["emotionCurve", 2],
  ["sellingPointPattern", 1.5],
  ["ctaPattern", 1.5],
];

const scalarFilterKeys = new Set<keyof CreativeCase>([
  "brand",
  "productCategory",
  "platform",
  "targetAudience",
  "hookType",
]);

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function tokenize(value: string): Set<string> {
  const normalized = normalize(value);
  const tokens = new Set<string>();
  for (const segment of normalized.match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? []) {
    tokens.add(segment);
    if (/^[\p{Script=Han}]+$/u.test(segment)) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        tokens.add(segment.slice(index, index + 2));
      }
    }
  }
  return tokens;
}

function fieldValues(value: CreativeCase[keyof CreativeCase]): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  return [];
}

/**
 * Development-only keyword score, not cosine similarity.
 * Each matching token contributes its field weight; an exact query segment
 * contained in a field adds a 3x field-weight bonus. The fixed weights make
 * title, tags and hookType more influential than descriptive context.
 */
function keywordScore(creativeCase: CreativeCase, query: string): number {
  const queryTokens = tokenize(query);
  const querySegments = (normalize(query).match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? [])
    .filter((segment) => segment.length >= 2);
  let score = 0;

  for (const [field, weight] of weightedFields) {
    for (const value of fieldValues(creativeCase[field])) {
      const normalizedValue = normalize(value);
      const valueTokens = tokenize(value);
      for (const token of queryTokens) {
        if (valueTokens.has(token)) score += weight;
      }
      for (const segment of querySegments) {
        if (normalizedValue.includes(segment)) score += weight * 3;
      }
    }
  }
  return Math.round(score * 1000) / 1000;
}

function requestedStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [normalize(value)];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(normalize);
  }
  return [];
}

function matchesFilters(creativeCase: CreativeCase, filters?: Record<string, unknown>): boolean {
  if (!filters) return true;
  for (const [key, rawFilter] of Object.entries(filters)) {
    if (key === "tags") {
      const requested = requestedStrings(rawFilter);
      if (!requested.length) continue;
      const tags = new Set((creativeCase.tags ?? []).map(normalize));
      if (!requested.every((tag) => tags.has(tag))) return false;
      continue;
    }
    if (!scalarFilterKeys.has(key as keyof CreativeCase)) continue;
    const requested = requestedStrings(rawFilter);
    if (!requested.length) continue;
    const actual = creativeCase[key as keyof CreativeCase];
    if (typeof actual !== "string" || !requested.includes(normalize(actual))) return false;
  }
  return true;
}

function normalizeTopK(topK: number | undefined): number {
  if (topK === undefined || !Number.isFinite(topK)) return DEFAULT_TOP_K;
  return Math.max(0, Math.floor(topK));
}

export class MockRetrievalProvider implements RetrievalProvider {
  private readonly creativeCases: readonly CreativeCase[];

  constructor(creativeCases: readonly CreativeCase[] = developmentCreativeCases) {
    this.creativeCases = creativeCases;
  }

  async retrieve(input: RetrievalQuery, signal?: AbortSignal): Promise<RetrievalResult> {
    signal?.throwIfAborted();
    const query = input.query.trim();
    if (!query) return { query: input.query, hits: [] };

    const topK = normalizeTopK(input.topK);
    const hits = this.creativeCases
      .filter((creativeCase) => matchesFilters(creativeCase, input.filters))
      .map((creativeCase) => ({ creativeCase, score: keywordScore(creativeCase, query) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.creativeCase.id.localeCompare(right.creativeCase.id))
      .slice(0, topK)
      .map(({ creativeCase, score }) => creativeCaseToRetrievalHit(creativeCase, score));

    return {
      query: input.query,
      hits,
    };
  }
}
