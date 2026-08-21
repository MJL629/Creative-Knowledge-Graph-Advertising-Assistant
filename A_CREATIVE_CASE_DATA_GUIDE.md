# CreativeCase 数据指南

## 定位

`CreativeCase` 是 A 模块内部的创意知识对象，用于清洗案例、构建稳定语义文本，并映射到 C 冻结的 `RetrievalHit`。它不绑定数据库、向量存储、Embedding SDK、Agent 或 UI。

## 字段

| 字段 | 必填 | 含义 | 主要用途 |
|---|---:|---|---|
| `id` | 是 | 稳定且唯一的案例 ID，不使用数组下标 | 映射、Source Trace |
| `title` | 是 | 人工确认的简短案例标题 | Semantic Retrieval、展示 |
| `summary` | 是 | 仅包含已确认信息的案例摘要 | Semantic Retrieval、RetrievalHit content |
| `brand` | 否 | 已确认的品牌 | Metadata Filter、Semantic Retrieval |
| `productCategory` | 否 | 产品/服务品类 | Metadata Filter、Semantic Retrieval |
| `platform` | 否 | 内容发布或适用平台 | Metadata Filter、Semantic Retrieval |
| `targetAudience` | 否 | 已确认的目标受众 | Metadata Filter、Semantic Retrieval |
| `hookType` | 否 | 开场吸引机制 | Semantic Retrieval、Metadata Filter |
| `creativeElements` | 否 | 人物、道具、场景、视听或互动元素 | Semantic Retrieval |
| `motivationConflict` | 否 | 主体目标、阻碍或风险 | Semantic Retrieval |
| `storyStructure` | 否 | 内容叙事/信息展开结构 | Semantic Retrieval |
| `emotionCurve` | 否 | 按发生顺序记录的情绪阶段 | Semantic Retrieval |
| `sellingPointPattern` | 否 | 卖点如何进入行动或叙事 | Semantic Retrieval |
| `ctaPattern` | 否 | 行动号召方式 | Semantic Retrieval |
| `tags` | 否 | 人工确认的检索标签 | Metadata Filter、Semantic Retrieval |
| `rawText` | 否 | 可核验原始文本或人工记录，不进入标准 Embedding 文本 | 审计、重新清洗 |
| `sourceName` | 否 | 来源名称或明确的 fixture 标记 | Source Trace |
| `sourceUrl` | 否 | 可核验来源 URL | Source Trace |
| `language` | 否 | 内容语言，如 `zh-CN` | Metadata Filter |
| `schemaVersion` | 是 | 数据规范版本，当前为 `1` | 兼容与重建 |

`emotionCurve` 使用数组而非单字符串，以保留阶段顺序。`rawText` 可选：没有经过人工确认的真实原文时必须留空，不能为了填满 Schema 创作“原文”。

## 文本与映射规则

- `buildCreativeCaseEmbeddingText` 按固定顺序输出标题、品牌、品类、平台、受众、摘要及创意分析字段；缺失值跳过，`rawText` 与 source 不进入文本。
- `buildCreativeCaseRetrievalContent` 输出面向 Creative Context 的精简内容，不直接复制 `rawText`。
- `creativeCaseToRetrievalHit` 直接映射 `id/title`，原样保留检索层传入的 `score`；已确认的结构化字段进入 metadata；只有真实存在 `sourceName` 或 `sourceUrl` 时才输出 source。

## Golden Case 收集标准

1. 每条必须有稳定 ID、可读标题和不夸大的摘要。
2. 真实案例必须由人工核验来源；品牌、平台、受众、表现形式等只能记录来源可确认的信息。
3. 没有真实来源时，只能作为 `Development fixture`，不得在产品或评测报告中称为真实广告案例。
4. 数据集应覆盖不同品类、平台、受众、Hook、故事结构和创意元素，避免同质化扩充。
5. 缺失字段保持缺失。禁止 AI 猜测情绪曲线、投放平台、受众、品牌、效果数据或来源 URL。
6. URL 应指向可复核的原始页面或可信归档；不使用搜索结果页、模型生成 URL 或无法访问的占位链接。

当前 `developmentCreativeCases` 共 12 条，全部是为验证 Schema、Mapper 和后续本地 Mock 检索而编写的 development fixture，不是真实广告案例，也没有真实品牌或来源 URL。

## Development Local Retrieval 行为

- 使用现有 `MockRetrievalProvider` 对 development fixture 做确定性关键词匹配；这不是向量相似度，也不能代表正式 RAG 质量。
- 执行顺序固定为：metadata filter → keyword matching → score 降序 → ID 字典序稳定 tie-break → topK。
- 默认 `topK=3`；零或负数返回空数组；超过匹配数时只返回现有命中。
- 支持 `brand/productCategory/platform/targetAudience/hookType` 的大小写不敏感精确匹配。筛选值为数组时，上述单值字段满足任意一个值即可。
- `tags` 使用大小写不敏感精确匹配；数组筛选要求案例同时具有全部请求标签。
- 未知 filter key 与空/无效 filter value 被忽略，确保未来 Contract 扩展不会使 Development Provider 崩溃。
- 空 query、无关键词命中或筛选后无候选均返回 `hits: []`，不会补充不相关案例。

## 扩充到 100+ Case 的质量门槛

- 建立“采集人、复核人、复核日期”的外部数据治理记录，再批量入库。
- 对 ID、来源 URL 和核心文本做重复检查；相同案例的不同转载不重复计数。
- 每次变更保留 `schemaVersion`，文本构建规则变化时执行回归测试。
- 按品类、平台、受众和 Hook 统计覆盖度，设定最低覆盖目标，不能只追求总量。
- 抽检 summary 与结构化字段是否能从 source 复核，并统计来源完整率与字段缺失率。
- 先用固定 Query Evaluation 验证新增数据是否改善检索，再决定是否进入正式知识集。
