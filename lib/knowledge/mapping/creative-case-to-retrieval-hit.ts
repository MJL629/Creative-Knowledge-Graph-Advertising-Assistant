import type { RetrievalHit } from "../../contracts";
import type { CreativeCase } from "../domain/creative-case";
import { buildCreativeCaseRetrievalContent } from "../text/creative-case-text";

function definedMetadata(creativeCase: CreativeCase): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [
    ["brand", creativeCase.brand],
    ["productCategory", creativeCase.productCategory],
    ["platform", creativeCase.platform],
    ["targetAudience", creativeCase.targetAudience],
    ["hookType", creativeCase.hookType],
    ["creativeElements", creativeCase.creativeElements],
    ["motivationConflict", creativeCase.motivationConflict],
    ["storyStructure", creativeCase.storyStructure],
    ["emotionCurve", creativeCase.emotionCurve],
    ["sellingPointPattern", creativeCase.sellingPointPattern],
    ["ctaPattern", creativeCase.ctaPattern],
    ["tags", creativeCase.tags],
    ["language", creativeCase.language],
    ["schemaVersion", creativeCase.schemaVersion],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

/** Pure mapping. The retrieval layer owns score calculation and ranking. */
export function creativeCaseToRetrievalHit(creativeCase: CreativeCase, score: number): RetrievalHit {
  const source = creativeCase.sourceName || creativeCase.sourceUrl
    ? { name: creativeCase.sourceName, url: creativeCase.sourceUrl }
    : undefined;

  return {
    id: creativeCase.id,
    title: creativeCase.title,
    content: buildCreativeCaseRetrievalContent(creativeCase),
    score,
    metadata: definedMetadata(creativeCase),
    ...(source ? { source } : {}),
  };
}
