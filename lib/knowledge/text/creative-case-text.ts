import type { CreativeCase } from "../domain/creative-case";

type TextLine = [label: string, value: string | string[] | undefined];

function appendPresentLines(lines: TextLine[]): string {
  return lines
    .filter((entry): entry is [string, string | string[]] => {
      const value = entry[1];
      return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
    })
    .map(([label, value]) => `${label}：${Array.isArray(value) ? value.join("、") : value.trim()}`)
    .join("\n");
}

/** Stable semantic representation for a future EmbeddingProvider. */
export function buildCreativeCaseEmbeddingText(creativeCase: CreativeCase): string {
  return appendPresentLines([
    ["标题", creativeCase.title],
    ["品牌", creativeCase.brand],
    ["品类", creativeCase.productCategory],
    ["平台", creativeCase.platform],
    ["目标受众", creativeCase.targetAudience],
    ["案例摘要", creativeCase.summary],
    ["Hook", creativeCase.hookType],
    ["创意元素", creativeCase.creativeElements],
    ["核心冲突", creativeCase.motivationConflict],
    ["故事结构", creativeCase.storyStructure],
    ["情绪曲线", creativeCase.emotionCurve],
    ["卖点植入", creativeCase.sellingPointPattern],
    ["CTA", creativeCase.ctaPattern],
    ["标签", creativeCase.tags],
  ]);
}

/** Compact, deterministic context exposed through RetrievalHit.content. */
export function buildCreativeCaseRetrievalContent(creativeCase: CreativeCase): string {
  return appendPresentLines([
    ["案例摘要", creativeCase.summary],
    ["Hook", creativeCase.hookType],
    ["创意元素", creativeCase.creativeElements],
    ["核心冲突", creativeCase.motivationConflict],
    ["故事结构", creativeCase.storyStructure],
    ["情绪曲线", creativeCase.emotionCurve],
    ["卖点植入", creativeCase.sellingPointPattern],
    ["CTA", creativeCase.ctaPattern],
  ]);
}
