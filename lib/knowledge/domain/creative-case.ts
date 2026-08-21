/**
 * A-side domain model for a reusable creative knowledge case.
 *
 * Semantic retrieval fields describe what made the creative work: title,
 * summary, hook, elements, conflict, structure, emotion, selling point and CTA.
 * Metadata filter fields describe where the case applies: brand, category,
 * platform, audience, tags and language.
 *
 * This model is intentionally independent of databases, vector stores and
 * embedding SDKs. Unknown facts must remain absent rather than be inferred.
 */
export interface CreativeCase {
  id: string;
  title: string;
  summary: string;

  brand?: string;
  productCategory?: string;
  platform?: string;
  targetAudience?: string;

  hookType?: string;
  creativeElements?: string[];
  motivationConflict?: string;
  storyStructure?: string;
  emotionCurve?: string[];
  sellingPointPattern?: string;
  ctaPattern?: string;

  tags?: string[];
  rawText?: string;

  sourceName?: string;
  sourceUrl?: string;

  language?: string;
  schemaVersion: number;
}
