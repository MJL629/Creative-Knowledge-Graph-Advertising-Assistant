# 候选节点决策与 Story 收敛流程

## 1. 这一部分解决什么

首轮会产生 6 个候选，每次生长又会产生 3 个候选。它们都只是备选内容，不应直接被当成正式知识图谱节点或写入最终故事。

本模块将整个过程分为两个明确阶段：

1. 决策阶段：每个候选必须变成 `adopted` 或 `rejected`；
2. 收敛阶段：只用正式 `GraphSnapshot` 中的 adopted 节点和边生成 Story。

`pending`、`rejected`、`superseded` 内容一律不能成为 Story 设定。

## 2. 整体数据流

```text
首轮候选 / 生长候选
  -> CandidateRegistry 注册为 pending
  -> 用户逐个采用或拒绝
  -> adopted 候选映射为 GraphSnapshot 正式节点
  -> pending_ids 必须为空
  -> Story Context 只投影 adopted 子图
  -> Story Health Check
  -> Story Planner 生成带节点引用的 Beats
  -> Story Writer 生成带溯源引用的 Segments
  -> Deterministic Validator
  -> Story Critic
       -> 通过 -> Finalize
       -> 不通过且未超限 -> Beat 级 Repair -> Validator -> Critic
       -> 超限 -> needs_review
```

## 3. CandidateRegistry：候选的唯一决策账本

`SharedState.candidate_registry` 保存两类信息：

- `candidates`：候选的原始记录，包含来源 run、分类、标题和完整 payload；
- `decisions`：候选的决策状态、正式节点 ID、决策人、时间和拒绝原因。

同时维护三个可直接给 API 和前端使用的索引：

- `pending_ids`：尚未决策；
- `adopted_ids`：已采用；
- `rejected_ids`：已拒绝或已被替代。

首轮候选 ID 使用 `candidate:{first_round_run_id}:{client_key}`，生长候选使用已有的 run 命名空间 ID，因此不会与首轮六个节点冲突。

## 4. 采用和拒绝如何改变图谱

### 4.1 首轮决策

`apply_first_round_decisions()` 同时接收 `adopted_client_keys` 和 `rejected_client_keys`。它会：

1. 检查采用和拒绝列表不重叠；
2. 为 adopted 候选分配正式 `node_id`；
3. 只保留两端都已采用的支撑关系；
4. 重建完整 `GraphSnapshot`；
5. 同步更新 `CandidateRegistry`。

允许采用多个首轮候选，但至少要采用一个。只有 adopted 候选会进入图谱。

### 4.2 生长决策

当前 Demo 将每批 3 个生长候选视为同一个选择单元：

- `adopt_growth_candidate()`：采用一个，同批其余候选全部拒绝，图版本 `+1`；
- `reject_growth_candidates()`：整批拒绝，不改图、不增加图版本。

两个函数都要求 `expected_graph_version` 与当前图版本一致，用于防止前端在旧图上提交决策。

## 5. StoryState 的结构

`SharedState.story` 始终存在，并在 `create_story_run_state()` 中完整重置。它包含：

| 字段 | 作用 |
|---|---|
| `request` | Story run ID、基础图版本、标题要求、是否必须覆盖全部 adopted 节点 |
| `context` | adopted 节点与边、Brief 硬约束、主体、卖点和被拒绝签名 |
| `readiness` | 类别完备性、产品融入、孤立节点和时长负载检查 |
| `plan` | 带 `node_refs` / `relation_refs` 的 Story Beats |
| `draft` | 带溯源引用的 Story Segments 和完整文案 |
| `validation` | 程序可确定的错误 |
| `critique` | 模型语义评分、问题和 Repair Plan |
| `result` | 给 API 返回的最终 Story 结果 |

Story 节点不会改写 `draft`、`growth`、`graph_snapshot` 和 `candidate_registry`，只会通过 `rebuild_story()` 产生新的 Story 子状态，再通过 `rebuild_state()` 返回完整新 State。

## 6. Story LangGraph 节点

### 6.1 Request Validator

在任何模型调用前检查：

- 必须处于 `story_convergence` 阶段；
- Story 请求的基础图版本必须与当前图一致；
- 图中至少有一个 adopted 节点；
- `candidate_registry.pending_ids` 必须为空。

失败时直接返回 `failed`，不消耗模型调用。

### 6.2 Context Builder

只从 `GraphSnapshot` 复制 adopted 节点和边。被拒绝内容只作为 `rejected_signatures` 负面约束，不是可使用设定。

### 6.3 Health Check

在调用 Story Agent 前检查：

- adopted 子图是否同时具备创意元素、动机与冲突、剧情事件；
- 是否存在产品或卖点引用；
- adopted 节点数量是否超出目标视频时长的可表达容量；
- 是否存在孤立节点。孤立节点默认是 warning，不直接阻断。

缺少三类中的任一类时返回 `needs_more_nodes`，前端应引导用户继续生长，而不是让模型自行虚构缺失节点。

### 6.4 Story Planner

Planner 将 adopted 子图组织成 `hook -> setup -> development -> turning_point -> climax -> cta` 的 Beat 计划。每个 Beat 都必须声明：

- 使用哪些 `node_refs`；
- 使用哪些 `relation_refs`；
- 体现哪些 `product_feature_refs`；
- 预计时长和叙事功能。

`node_coverage` 使“某个 adopted 节点是否被忽略”可以直接检查，不需要从自由文本中猜测。

### 6.5 Story Writer

Writer 不接收全部候选，只接收 Story Context 和 Plan。输出的每个 Segment 保留 Beat 的节点、关系、卖点和时长引用，便于后端审计和前端高亮对应图节点。

### 6.6 Deterministic Validator

Validator 不依赖模型，确定性检查：

- 是否覆盖所有 adopted 节点；
- 是否引用了未知或未采用节点；
- 是否引用了未采用的边；
- `used_node_ids` 是否与 Segment 真实引用一致；
- 卖点引用是否来自 Brief；
- 分段总时长和草稿总时长是否等于 Brief 时长；
- CTA 是否存在；
- `mustAvoid` 内容和被拒绝候选标题是否被写入。

### 6.7 Story Critic 与 Repair

Critic 负责主体一致性、因果、节奏、产品融入、风格和平台适配等语义评估。程序 Validator 的 error 会被强制合并进 Critic 结果，模型不能用 `passed=true` 绕过硬错误。

Repair 使用：

- `preserve_beat_ids`：不允许改写；
- `rewrite_beat_ids`：只修复指定 Beat；
- `missing_node_ids`：补回被忽略的 adopted 节点；
- `remove_unapproved_facts`：删除未采用设定。

默认最多修复 1 次，超限返回 `needs_review`，避免无限循环和无限 token 消耗。

## 7. 最终状态的前端含义

| `story.result.status` | 前端处理 |
|---|---|
| `ready` | 展示正式 Story，允许导出或继续人工编辑 |
| `needs_more_nodes` | 展示 `missing_story_functions`，引导返回生长面板 |
| `needs_review` | 展示未通过的 Critic / Validator 问题，允许人工修改或再试 |
| `failed` | 展示 State 阶段、图版本或 pending 决策错误 |

前端在“生成 Story”按钮上应先做同样的轻量检查：`pending_ids.length === 0`。但后端检查仍然必须保留，不能信任前端。

## 8. 运行 Demo

Mock 模式不需要 API Key：

```powershell
python examples\story_demo.py
```

该 Demo 会执行：首轮生成 -> 采用 `element_1/conflict_1/event_1` -> 拒绝其余 3 个 -> Story 收敛。

使用 DeepSeek OpenAI-compatible 配置时：

```powershell
$env:CREATIVE_MODEL_PROVIDER = "deepseek"
$env:OPENAI_API_KEY = "你的密钥"
$env:OPENAI_BASE_URL = "https://api.deepseek.com"
$env:OPENAI_MODEL = "deepseek-chat"
python examples\story_demo.py
```

## 9. 代码入口

| 文件 | 职责 |
|---|---|
| `state.py` | CandidateRegistry、StoryState、候选决策、图版本和完整 State 重建 |
| `prompts.py` | Planner、Writer、Critic、Repair Prompt 和 JSON 输出契约 |
| `story_nodes.py` | Context、Health Check、确定性 Validator、Story Agent 和路由 |
| `story_workflow.py` | Story `StateGraph` 的边和条件边 |
| `model.py` | OpenAI-compatible 调用与 Story Mock |
| `examples/story_demo.py` | 候选决策到 Story 生成的最小示例 |
| `tests/test_story_workflow.py` | pending、图版本、完备性、溯源、Repair 和不可变性回归测试 |

## 10. 当前边界

- Python 层实现了领域 State 和 LangGraph 工作流，尚未增加 HTTP/SSE 路由；
- 正式节点 ID 在 Demo 中由本地 helper 生成，生产环境应由数据库事务分配；
- 生长批次当前是“单选一个或整批拒绝”；如产品改为生长候选多选，需将同批多节点和它们的边放在同一个数据库事务中一次提交；
- 语义重复目前主要依靠文本和 Critic，生产环境可再加 embedding 检索；
- Story 生成不会修改知识图谱；若用户修改了图，必须创建新 Story run。
