# A Knowledge & RAG 接入实施计划

> 审计基线：`feature/knowledge-rag` 分支，2026-08-20。本文只描述接入方案，不实现 Embedding、向量数据库或 Agent Pipeline 变更。结论以当前代码为准；`ROADMAP.md` 中“RAG 无实现”“数据库未接入”等描述已落后于仓库现状。

## 1. 当前仓库真实状态

### 1.1 技术与目录

- 项目是 React 19 + TypeScript + vinext/Vite 的全栈应用，Node 要求 `>=22.13.0`（`package.json`）。当前没有根级 `components/` 目录，页面与交互集中在 `app/page.tsx`。
- `app/api/graph/*` 保留四条旧 Agent API；`app/api/workflow/*` 是新的 LangGraph 编排入口。`docs/WORKFLOW.md` 明确建议新编排客户端使用 Workflow API。
- `lib/agents/graph-pipeline.ts` 承载首轮发散、关系推荐、剧情收敛；`lib/agents/growth-pipeline.ts` 承载受控生长；`lib/agents/creative-agent-gateway.ts` 以 `CreativeAgentGateway` 适配两套旧 Pipeline。
- `lib/workflow/creative-workflow.ts` 已是显式 LangGraph `StateGraph`，节点依赖通过构造参数注入，不写入 checkpoint。
- `lib/repositories/` 已有 Memory/PostgreSQL Repository；正式业务表 migration 位于 `db/migrations/`。`db/schema.ts` 仍为空，但这不代表没有 PostgreSQL：当前 SQL migration 与 `postgres-project-repository.ts` 是真实实现。
- 依赖中已有 `postgres`、`drizzle-orm`、LangGraph 及 PostgreSQL checkpointer，但没有 pgvector/Embedding SDK。

### 1.2 当前主链路

`lib/workflow/creative-workflow.ts` 当前链路为：

```text
load_project_context
  -> context_plan
  -> (needRag ? retrieve_context : intent route)
  -> creative_divergence | creative_growth | relation_suggestion | story_convergence
  -> validate_candidate（前三类意图）
  -> human_decision
  -> commit_graph
```

`CreativeState`（`lib/workflow/creative-state.ts`）已保存 `needRag`、`retrievalQuery`、`retrievedContext`。`WorkflowRuntime` 在 `lib/workflow/workflow-runtime.ts` 中接收 `RetrievalProvider`，`lib/workflow/index.ts` 通过 `getRetrievalProvider()` 完成装配。

### 1.3 关键业务类型

- `CreativeBrief`（`lib/contracts/creative-brief.ts`）：核心字段是 `product`、`knownFacts`、`ideaFragments`、`mustKeep`、`forbidden`、`constraints`，并保留 `audience`、`platform`、`styles`、`sellingPoints` 等 Demo 兼容字段。
- 首轮 `Candidate`（`lib/agents/graph-pipeline.ts`）：`clientKey/category/subtype/title/description/attributes/rationale`。
- 生长 `GrowthCandidate`（`lib/agents/growth-pipeline.ts`）：在上述内容基础上增加 `parentRef`、`actorRefs`、`productFeatureRefs`、`growthMode`、`subjectContinuity`。
- 正式 `GraphNode`（`lib/contracts/graph.ts`）：已有 `sourceRefs?: string[]` 与 `provenance?: string`，数据库也已有 `graph_nodes.source_refs JSONB`、`provenance TEXT`；`GraphEdge` 同样已有 `sourceRefs?: string[]`。

## 2. 已存在的 RAG / `need_rag` 能力

### 已存在

1. C 冻结的 Contract 已原样存在于 `lib/contracts/retrieval.ts`，无需也不得修改。
2. `lib/retrieval/mock-retrieval-provider.ts` 提供固定 Mock；`tests/fixtures/sample-retrieval-result.json` 提供契约 fixture。
3. `lib/retrieval/http-retrieval-provider.ts` 提供 HTTP Adapter，包含超时、非 2xx、响应结构校验及 `AbortSignal` 合并。
4. `lib/retrieval/index.ts` 通过 `RETRIEVAL_PROVIDER=mock|real` 选择 Provider，也允许 `registerRealRetrievalProvider()` 注入实现。
5. Workflow 已有可选 `retrieve_context` 节点、检索 trace、`retrievalHitCount` 以及失败降级；相关测试位于 `tests/workflow-runtime.unit.test.ts`、`tests/workflow-postgres.test.ts`、`tests/observability-retrieval.unit.test.ts`。
6. 旧 Supervisor Structured Decision 在 `graph-pipeline.ts` 与 `growth-pipeline.ts` 中都输出 `need_rag` / `need_memory`。

### 尚未真正闭环

- Workflow 的 `needRag` 与旧 Pipeline Supervisor 的 `decision.need_rag` 是两套判断。Workflow 先检索，进入 Gateway 后旧 Supervisor 才再次判断；后者当前不驱动 Workflow 路由。
- `lib/workflow/context-builder.ts#buildStartContext` 把 hit 摘要放进 `CreativeBrief.constraints.retrievalSummary`，但 `creative-agent-gateway.ts#toPipelineBrief` 不保留该字段，因此首轮 Creative Prompt 实际收不到检索内容。
- `core-nodes.ts#creativeGrowth` 在匿名输入中携带 `retrievedContext`，但 `GrowthRequest` 未声明该字段，`growth-pipeline.ts#creativeAgent` 构造 Prompt 时也没有读取它。因此生长链路同样未消费检索内容。
- 关系推荐和剧情收敛节点当前不传递 `retrievedContext`。
- `core-nodes.ts#contextPlan` 使用 `state.needRag || (!brief.knownFacts?.length && Boolean(query))`。这意味着调用方显式传 `needRag: false` 仍可能触发检索，无法满足“关闭时完全不影响原流程”。
- 检索调用没有把上游 `AbortSignal` 显式传给 `retrievalProvider.retrieve()`；HTTP Provider 虽支持 timeout，但工作流取消信号尚未贯通。
- `ROADMAP.md` 第 P1-1 节称 `need_rag` “无实现”，与上述脚手架现状不符；应把它理解为“真实知识库与有效 Prompt 注入未完成”。

结论：当前完成的是 **Contract + Adapter + Workflow 骨架 + 容错**，不是可验证有效的 RAG 产品闭环。

## 3. A 与现有代码的接口关系

边界应保持如下：

```text
A Domain: CreativeCase / normalization / embedding text
        ↓
A Infrastructure: embedding + pgvector query + result mapper
        ↓ implements
C frozen contract: RetrievalProvider
        ↓ injected by
lib/retrieval/index.ts -> WorkflowRuntime -> createCreativeWorkflow
        ↓
C Workflow: retrieve_context / state / fallback
        ↓
B Agent boundary: CreativeAgentGateway receives compact RAG context
        ↓
D UI/quality: 展示真实 source refs、执行开关对照与固定查询评测
```

A 不应修改 API Route、Repository 事务语义或 Agent Prompt。A 可独立实现 Provider 后通过现有 `registerRealRetrievalProvider()` 或 `RETRIEVAL_PROVIDER=real` HTTP 边界交付。

## 4. 推荐 `CreativeCase` Schema

建议把它放在 A 内部 Domain，不导出为跨团队 Contract，也不携带数据库字段名或 pgvector 类型：

```ts
export interface CreativeCase {
  id: string;

  brand?: string;
  productCategory?: string;
  platform?: string;
  targetAudience?: string;

  title?: string;
  summary?: string;

  hookType?: string;
  creativeElements?: string[];
  motivationConflict?: string;
  storyStructure?: string;
  emotionCurve?: string[];
  sellingPointPattern?: string;
  ctaPattern?: string;

  tags?: string[];
  rawText: string;

  sourceName?: string;
  sourceUrl?: string;

  language?: string;
  schemaVersion: number;
}
```

字段取舍：

- `id` 必填且稳定，是检索命中、Embedding 和 Source Trace 的共同主键；不能用向量行 ID 或数组下标。
- `rawText` 必填，保存可回溯原始案例文本；若只有结构化摘要，应明确它就是当前可验证原文，不能补写虚构事实。
- 用户列出的分析字段全部值得保留，但除 `id/rawText` 外均允许为空。`emotionCurve` 用 `string[]` 保留顺序；其余模式字段先用开放字符串，避免早期枚举因样本不足频繁迁移。
- 新增 `language?`：便于中文/英文分库或过滤，也影响未来 Embedding 模型选择；未知时为空。
- 新增 `schemaVersion`：Golden Case 会持续清洗，需区分 normalization 规则版本；它是领域版本而非数据库 migration 版本。
- 第一版不新增 `createdAt/updatedAt/publishedAt/campaignId/metrics`。当前真实代码与案例来源没有稳定供给这些信息，提前加入容易诱导伪造；以后有可信来源再扩展。

### 字段用途

| 用途 | 字段 |
|---|---|
| 主要参与向量文本 | `title`、`summary`、`hookType`、`creativeElements`、`motivationConflict`、`storyStructure`、`emotionCurve`、`sellingPointPattern`、`ctaPattern`、`tags`、必要时截取 `rawText` |
| metadata filter | `brand`、`productCategory`、`platform`、`targetAudience`、`hookType`、`tags`、`language`、`schemaVersion` |
| Source Trace | `id`、`sourceName`、`sourceUrl` |
| 原始审计/重建 | `rawText` |

`brand` 等短分类字段不应只靠向量匹配；应同时进入语义文本与 metadata（是否进入语义文本由固定 builder 决定）。`sourceUrl` 不参与 Embedding。Embedding text builder 必须跳过空值、使用固定字段顺序和标签，确保重建可复现。

## 5. `CreativeCase -> RetrievalHit` 映射

```ts
function toRetrievalHit(caseItem: CreativeCase, score: number): RetrievalHit {
  return {
    id: caseItem.id,
    title: caseItem.title,
    content: buildRetrievalContent(caseItem),
    score,
    metadata: compactUndefined({
      brand: caseItem.brand,
      productCategory: caseItem.productCategory,
      platform: caseItem.platform,
      targetAudience: caseItem.targetAudience,
      hookType: caseItem.hookType,
      creativeElements: caseItem.creativeElements,
      motivationConflict: caseItem.motivationConflict,
      storyStructure: caseItem.storyStructure,
      emotionCurve: caseItem.emotionCurve,
      sellingPointPattern: caseItem.sellingPointPattern,
      ctaPattern: caseItem.ctaPattern,
      tags: caseItem.tags,
      language: caseItem.language,
      schemaVersion: caseItem.schemaVersion,
    }),
    source: compactUndefined({
      name: caseItem.sourceName,
      url: caseItem.sourceUrl,
    }),
  };
}
```

- `RetrievalHit.id` 直接来自 `CreativeCase.id`。
- `title` 来自案例 `title`；缺失就保持 `undefined`，不要用品牌或模式伪造标题。
- `content` 是供 Agent 使用的精简、确定性文本，按“标题/摘要/钩子/创意元素/冲突/故事结构/情绪曲线/卖点模式/CTA/必要原文摘录”的固定顺序拼接；需设置字符预算，不能把整份 `rawText` 无界注入 Prompt。
- `score` 只由检索层产生并按降序返回，Domain mapper 不计算或改写。
- metadata 只装真实、可过滤/审计字段，不放向量、数据库主键或 undefined。
- `source.name/url` 直接来自案例来源；没有 URL 时可只返回 name，没有可靠来源时两者均缺失，同时该案例不应被标记成“可外部核验”。

## 6. 推荐目录结构

在现有 `lib/contracts`、`lib/retrieval` 旁增量扩展，不另建独立 RAG 项目：

```text
lib/
  contracts/
    retrieval.ts                         # C 冻结 Contract；不改
  knowledge/
    domain/
      creative-case.ts                   # CreativeCase 与领域校验
    normalization/
      normalize-creative-case.ts         # 原始素材 -> CreativeCase，不推断未知值
    text/
      build-embedding-text.ts             # 可复现的向量文本
      build-retrieval-content.ts          # 给 Agent 的有界 content
    mapping/
      creative-case-to-retrieval-hit.ts   # Domain -> 固定 Contract
    sources/
      source-ref.ts                       # 内部 source 校验/规范化，不改公共 Contract
    fixtures/
      golden-cases.ts                     # 10~20 条人工核验 Golden Case
  retrieval/
    index.ts                              # 保留现有 Provider 选择/注册入口
    mock-retrieval-provider.ts            # 逐步改为基于 Golden Case 的确定性 Mock
    http-retrieval-provider.ts            # 保留现有远程 Adapter
    embedding/
      embedding-provider.ts               # A 内部 Embedding 抽象
    pgvector/
      pgvector-retrieval-provider.ts       # RetrievalProvider 实现
      creative-case-store.ts              # 入库/查询基础设施边界
    evaluation/
      queries.ts                           # 固定 Query 与期望命中
      evaluate-retrieval.ts                # Recall@K/MRR/过滤/来源完整率
tests/
  knowledge-*.unit.test.ts
  retrieval-*.unit.test.ts
  fixtures/sample-retrieval-result.json   # 继续作为跨团队 Contract fixture
```

- Domain：`CreativeCase`、字段验证、normalization 规则。
- Adapter/Infrastructure：Embedding client、PostgreSQL/pgvector store、HTTP adapter。
- Provider：`pgvector-retrieval-provider.ts` 对外只实现冻结的 `RetrievalProvider`。
- Evaluation：固定查询、期望案例 ID、指标计算，不调用 Agent，先独立验证检索质量。
- 与 C 的边界：`lib/contracts/retrieval.ts`、Provider 装配、Workflow State/路由/超时降级。
- 与 B 的边界：紧凑 `RagContext` 的输入位置与 Prompt 消费规则。
- 与 D 的边界：开关实验、No Result/失败体验、source 展示与端到端验收。

若 A 的真实 pgvector 服务独立部署，仓库内仍保留 Domain/fixture/evaluation，远端服务通过现有 `HttpRetrievalProvider` 接入；不要让 Agent 直接访问数据库。

## 7. RetrievalProvider 接入位置

### 判断 `need_rag`

当前最合适的确定性接入点仍是 `lib/workflow/nodes/core-nodes.ts#contextPlan` 后、`workflow-router.ts#routeAfterContext` 中的条件分支。不要在 `graph-pipeline.ts#creativeAgent` 内临时调用检索，否则难以 trace、timeout、测试和降级。

但需要 C 明确开关语义后再改代码。推荐第一版把请求字段定义为三态：

- `true`：强制尝试检索；
- `false`：明确禁用，完全走原链路；
- `undefined`：允许业务规则/Supervisor 决定。

当前 `WorkflowRuntime` 用 `input.needRag ?? false` 抹平了 `undefined`，且 `contextPlan` 又可能把 false 改成 true，必须由 C 统一语义。若 C 不接受三态，第一版应采用更简单的显式布尔开关，以 `false` 为绝对禁用。

旧 Pipeline 中 Supervisor 的 `decision.need_rag` 不能直接作为当前前置检索判断，因为它发生在 Gateway 内、晚于 Workflow 的检索节点。要真正由 Supervisor 决策，需要 C/B 将“规划”提升为 Workflow 节点或拆分 Gateway；这属于主流程修改，本轮不做。

### Provider 注入

沿用已有依赖注入：`lib/retrieval/index.ts#getRetrievalProvider` -> `lib/workflow/index.ts` -> `WorkflowRuntime` -> `createCreativeWorkflow` -> `createWorkflowNodes`。pgvector 实现不应在 Node 中直接 new，也不应进入 State。

### Result 传递

保留 `CreativeState.retrievedContext: RetrievalResult | undefined` 作为 checkpoint 内的原始检索结果；在调用 `CreativeAgentGateway` 前，由纯函数将其压缩为内部 `RagContext`：

```ts
type RagContext = {
  query: string;
  items: Array<{
    refId: string;       // RetrievalHit.id
    title?: string;
    excerpt: string;     // 从 hit.content 截断
    sourceName?: string;
    sourceUrl?: string;
  }>;
};
```

不建议继续塞进 `CreativeBrief.constraints`：它污染 Brief 领域语义，并已被 Gateway 转换丢失。推荐由 B/C 在 `CreativeAgentGateway` 的方法输入或 `AgentRunContext` 的专用扩展中显式接收 `ragContext`；具体签名需 C 确认，因为 `CreativeAgentGateway` 也是共享边界。

### 各意图第一版范围

- `start`、`grow`：需要 RAG，优先接入。
- `relations`：通常基于两个已知节点和现有边即可，第一版默认不检索。
- `concept`：应只基于已采用子图收敛，第一版默认不检索，避免外部案例改写已确认事实。

这也能避免 RAG 成为所有 Creative 请求的强制前置步骤。

## 8. RAG Context 容错与无侵入方案

1. `needRag === false`：不进入 `retrieve_context`，不创建空占位 Prompt，不改变 Brief，不增加 Provider 延迟。
2. `hits.length === 0`：规范化为无 `ragContext`（或 `items: []`），Creative 使用原输入继续；记录 hit count 0，不提示模型“必须引用案例”。
3. timeout/exception：沿用 `core-nodes.ts#retrieveContext` catch 后降级到非 RAG 路径；保留 trace/error 供观测，不将异常抛到整个 Creative Pipeline。
4. 应把请求取消信号传入 `retrieve(input, signal)`，并区分用户取消与 Provider timeout；这项由 C 接线。
5. 对 Prompt 设置独立预算：例如 topK 先取 5，但 mapper 最多输出 3~5 条、每条固定字符上限，并去除空字段。
6. Creative Prompt 将命中视为“灵感证据而非用户事实”；Brief 的 `mustKeep/forbidden` 优先级更高。
7. 检索失败不重试 Agent 全链路；Provider 内最多做有限、可观测重试，避免重复费用和延迟放大。

现有 State 已足够保存 `RetrievalResult`，无需为原始结果再加 State 字段；建议新增的 `RagContext` 是 B/C 之间的进程内输入类型，不必 checkpoint，除非未来需要精确复现 Prompt。

## 9. Source Trace 方案

### 已有能力

- `GraphNode.sourceRefs?: string[]`、`GraphEdge.sourceRefs?: string[]` 已存在于 `lib/contracts/graph.ts`。
- PostgreSQL 已持久化 `graph_nodes.source_refs`、`graph_edges.source_refs`；`provenance` 是展示字符串，不适合作为机器可验证引用。
- 前端 `app/page.tsx` 当前使用 `provenance` 展示“DeepSeek · Creative Agent · rationale”，这是生成来源描述，不是知识来源证据。

### 第一版最小粒度

一次 Creative 调用读取 3 个 hit、生成多个 Candidate 时，第一版采用 **run-level retrieval set 复制到本次所有候选**：每个 Candidate/后续 Graph Node 的 `sourceRefs` 保存实际提供给该次 Prompt 的 hit IDs，例如 `knowledge:case_001`。原因：当前 Candidate Schema 没有逐候选引用字段，且让 LLM 自报“用了哪条”不可信。

这一级别表达的是“该候选生成时可访问这些来源”，不是“该候选严格由每一来源支持”。业务代码必须从真实 `RagContext.items[].refId` 写入，LLM 不得生成、改写或补全 `sourceRefs`。

推荐提交路径：

```text
RetrievalProvider 返回 hits
-> mapper 形成 RagContext，并保留 refId
-> Creative 只生成内容 Candidate
-> Workflow/业务代码给本次 Candidate 附加同一组 sourceRefs
-> 用户采用后 ADD_NODE operation 持久化 sourceRefs
```

约定应区分现有 Brief 引用与知识引用：`brief.product`、`brief.ideaFragments[0]` 保持现状；知识 ID 使用 `knowledge:<RetrievalHit.id>` 前缀。不要把 URL 直接作为 `sourceRefs`，URL 可能变化且不适合做主键。

第一版不做字段级 citation、句子级证据或 Candidate-hit 精确归因。若以后确实需要逐候选引用，应由业务代码基于受限候选引用索引校验：模型只能从输入的 `refId` 白名单选择，禁止自由文本来源。

来源详情如何从 `knowledge:case_001` 反查，是 A 的知识存储读取接口与 D 的展示需求，当前冻结 `RetrievalProvider` 只有 retrieve、没有 getById；需要与 C/D 决定是将 source 快照写入节点、增加独立只读 Source API，还是通过 trace/checkpoint 查询。第一版最小方案可同时在 Candidate 返回的非持久展示数据中携带命中 `source`，正式节点只存稳定 ID。

## 10. PostgreSQL + pgvector 边界设计

当前 `projects/graph_nodes/graph_edges/story_versions` 是产品业务数据，不应把案例知识塞进 Graph 表。未来可新增：

```text
creative_cases
  id text primary key
  schema_version integer not null
  brand text null
  product_category text null
  platform text null
  target_audience text null
  title text null
  summary text null
  hook_type text null
  creative_elements jsonb null
  motivation_conflict text null
  story_structure text null
  emotion_curve jsonb null
  selling_point_pattern text null
  cta_pattern text null
  tags jsonb null
  raw_text text not null
  source_name text null
  source_url text null
  language text null
  content_hash text not null
  created_at/updated_at timestamptz

creative_case_embeddings
  creative_case_id text references creative_cases(id) on delete cascade
  embedding_model text not null
  embedding_version text not null
  content_hash text not null
  embedding vector(<dimension>) not null
  created_at timestamptz
  primary key (creative_case_id, embedding_model, embedding_version)
```

说明：

- `content_hash` 是基础设施字段，用于判断结构化文本变化后是否需要重嵌入；不进入 `CreativeCase` Domain。
- 推荐独立 Embedding 表。它支持模型/维度并行迁移、重建向量而不锁住案例编辑，也避免将 A 的模型生命周期绑定到业务行。只有在明确“单模型、永不并行迁移”的极简 PoC 中才考虑同表。
- metadata filter 优先为高频单值字段建普通 B-tree 索引：`platform/product_category/brand/language/schema_version`。`tags` 初期可用 JSONB/数组与 GIN，等查询样本证明需要再规范化；不要过早拆多张维表。
- pgvector 索引（HNSW/IVFFlat）必须在真实样本量、维度和延迟目标确定后选择。10~100 条样本阶段顺序扫描足够，更利于验证正确性。
- `source_name/source_url` 保存在 `creative_cases`；若未来同一案例有多个来源或抓取版本，再拆 `creative_case_sources`，第一版不需要。
- 是否与现有 migration 同库由 C 决定。若同库，应追加新的有序 migration，不能修改 `0001/0002`；若 A 是独立 Retrieval 服务，则由 A 服务拥有表与 migration，主应用只走 HTTP Contract。
- `projectId` 在冻结 Query 中可选，但案例是公共知识还是项目私有知识尚未定义。不要在 schema 中假定 `creative_cases.project_id NOT NULL`；可在确认多租户需求后增加 scope/tenant 设计。

## 11. 需要与 B / C / D 确认的问题

### B（LLM & Agent）

1. `RagContext` 通过 Gateway 方法参数还是 `AgentRunContext` 传入？需避免继续藏在 `CreativeBrief.constraints`。
2. 首轮与生长 Prompt 的 token/字符预算、字段顺序、hit 数量上限是什么？
3. Prompt 是否明确“案例是灵感，不是用户事实；不得编造 source；不得原样抄袭案例”？
4. Candidate 是否暂不输出 citation（推荐），由业务层统一附加 run-level `sourceRefs`？
5. Repair 时应沿用第一次命中快照，避免每轮重新检索导致不可复现。

### C（Workflow & Backend）

1. `needRag` 的最终语义：显式开关还是 Supervisor 决策；是否接受 `true/false/undefined` 三态？
2. 当前自动规则“无 knownFacts 即检索”是否保留？它会覆盖显式 false。
3. 是否只给 `start/grow` 开 RAG；`relations/concept` 默认关闭？
4. 是否允许扩展 `CreativeAgentGateway` 共享输入类型；State 是否需记录压缩后的 `RagContext` 以支持精确重放？
5. pgvector 与业务 PostgreSQL 同库还是 A 独立服务？谁拥有 migration、连接池和密钥？
6. Source ID 的持久化格式与反查方式；是否需要只读 Source API？
7. 如何把 Workflow 的取消信号传入 Provider，以及 timeout 由 Provider 还是 Workflow 统一控制？

### D（Product & Quality）

1. 来源展示在候选阶段还是仅采用后的节点详情；无 URL 时如何呈现？
2. 是否接受第一版 run-level source set，而非逐 Candidate 精确归因？
3. 开/关 RAG 对照的评审量表：相关性、新颖性、可执行性、事实一致性、来源可信度。
4. No Result 与检索失败是否只做无感降级，还是向用户显示非阻断提示？
5. 固定 Query Evaluation 的业务场景、期望 top-K 与人工标注人。

## 12. A 后续开发阶段与顺序

| 阶段 | 交付物 | 依赖/协作 | 验收重点 |
|---|---|---|---|
| 0. 冻结语义 | 与 B/C/D 确认第 11 节 | 等 C/B/D | 开关、输入、trace 粒度无歧义 |
| 1. Schema + 纯函数 | `CreativeCase`、validator、normalizer、两类 text builder、mapper | A 独立 | 空字段不伪造、输出稳定、Contract 不变 |
| 2. 10~20 Golden Case | 人工可核验案例与来源 | A 主导，D 审核 | 每条原文/来源可信、字段允许缺失 |
| 3. Golden Mock Retrieval | 基于 fixture 的确定性关键词/过滤 Mock | A 独立 | topK/filter/空结果/AbortSignal 测试 |
| 4. 固定 Query Evaluation 基线 | 查询集、期望 ID、Recall@K/MRR/来源完整率 | A+D | 在接 Embedding 前先有可比较基线 |
| 5. Embedding Provider | A 内部抽象、批处理、模型/version/hash | A 独立；模型选择可与 C 确认部署 | 可复现、可重建、失败可观测 |
| 6. Vector Store | pgvector 表与 Provider | 需 C 确认部署/迁移归属 | 不改冻结 Contract，模型版本隔离 |
| 7. Top-K + metadata filter | 相似度、过滤、阈值、无结果策略 | A 独立，D 给业务用例 | 过滤正确，结果排序稳定 |
| 8. Source Trace 接线 | hit ID -> Candidate/GraphNode `sourceRefs` | 需 C；展示需 D | ID 来自业务层白名单，LLM 不造源 |
| 9. Agent 接入 | `RagContext` 注入 start/grow Prompt | 需 B+C | false 零影响，失败不阻断，Prompt 有预算 |
| 10. 端到端对照评测 | 同 Brief 开/关 RAG | B/C/D 配合 | 质量收益超过延迟与成本代价 |
| 11. 扩充 100+ Cases | 批量清洗、去重、回归评测 | A 主导，D 抽检 | 数据质量不因规模下降 |

相较原始顺序，建议把“固定 Query Evaluation 基线”提前到 Embedding 之前。AI 产品的核心不是“接上向量库”，而是先定义什么叫检索有效；否则无法判断 Embedding/索引变化是否真的带来收益。

## 13. 当前风险 / 冲突

| 优先级 | 风险/冲突 | 影响 | 建议 |
|---|---|---|---|
| P0 | 检索结果在 Gateway/Prompt 转换中被丢弃 | 看似调用 RAG，实际不影响生成 | B/C 显式定义 `RagContext` 输入 |
| P0 | `needRag: false` 仍可能被自动规则改为 true | 开关不可信、延迟不可控 | 冻结三态或显式 false 优先语义 |
| P0 | Workflow 与旧 Supervisor 各自判断 RAG | 决策来源冲突、难以解释 | 第一版只认 Workflow；后续再提升 Supervisor plan |
| P0 | LLM 可能自由生成来源 | 形成虚假可追溯性 | sourceRefs 只由业务代码写入真实 hit IDs |
| P1 | 当前 Source Trace 只有字符串数组，无反查接口 | 节点可存 ID但无法稳定展示详情 | 确认 source snapshot 或只读 Source API |
| P1 | `ROADMAP.md` 与代码现状不一致 | 重复造基础设施或错误排期 | 后续由项目 Owner 单独更新，A 本轮不改 |
| P1 | RetrievalResult 全量 checkpoint/Prompt 可能膨胀 | 成本、延迟、持久化体积增加 | 原结果限 topK，Prompt 使用紧凑 `RagContext` |
| P1 | `projectId` 的数据隔离语义未定义 | 未来多租户可能泄露私有案例 | pgvector 前先确认 public/project/tenant scope |
| P1 | HTTP 结构校验仅检查核心字段 | 恶意/超大 metadata 仍可能进入 State | A/C 增加大小、URL、字段白名单校验但不改 Contract |
| P2 | 10~20 案例上过早调 HNSW/IVFFlat | 优化目标失真 | 小数据先精确检索，100+ 后基准再定索引 |

## 14. 下一步最推荐执行的一个开发任务

**先完成“CreativeCase Domain + Golden Case Fixture + 纯函数 mapper”的垂直小切片，不接 Embedding、不改 Pipeline。**

具体范围：新增 `CreativeCase`、normalizer、`buildEmbeddingText`、`buildRetrievalContent`、`toRetrievalHit`，录入 10 条有真实来源的 Golden Case，并用单元测试验证：未知字段保持空、输出顺序稳定、source 不伪造、content 有长度上限、映射严格满足冻结 Contract。

这样 A 可以独立交付，且同时为 Mock Retrieval、Embedding、pgvector、Source Trace 和固定 Query Evaluation 提供同一个可信数据基座；等 B/C 明确 `RagContext` 与开关语义后再接主流程，返工最少。
