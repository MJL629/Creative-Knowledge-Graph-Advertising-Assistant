# 候选决策与 Story 生成技术实现总结

## 1. 实现目标

这一部分负责将首轮生成和后续生长产生的候选节点，经过用户采用或拒绝后，转换为正式的知识图谱子图，再只使用已采用内容生成最终 Story。

完整流程为：

```text
首轮候选 / 生长候选
  -> 候选注册
  -> 用户采用或拒绝
  -> 构建 adopted 知识子图
  -> Story 生成前健康检查
  -> Story Planner
  -> Story Writer
  -> Deterministic Validator
  -> Story Critic
  -> Beat 级局部修复
  -> 输出可溯源 Story
```

## 2. 统一候选决策账本

`SharedState` 中增加了 `candidate_registry`，统一管理首轮候选和生长候选。

```python
class CandidateRegistry(TypedDict):
    candidates: dict[str, RegisteredCandidate]
    decisions: dict[str, RegistryDecision]
    pending_ids: list[str]
    adopted_ids: list[str]
    rejected_ids: list[str]
```

其中：

- `candidates` 保存候选的原始内容、分类、来源 Run 和完整 Payload；
- `decisions` 保存决策状态、正式节点 ID、决策人、决策时间和拒绝原因；
- `pending_ids` 保存尚未处理的候选；
- `adopted_ids` 保存已采用候选；
- `rejected_ids` 保存已拒绝或已被替代候选。

每个候选只能处于以下一种状态：

```text
pending       尚未决策
adopted       已采用并进入正式图谱
rejected      已拒绝
superseded    已被其他候选替代
```

Story 生成前必须满足：

```python
state["candidate_registry"]["pending_ids"] == []
```

这保证了用户还没有决定的候选不会被模型擅自写入故事。

## 3. 候选决策与图谱更新

### 3.1 首轮候选

首轮候选通过以下函数提交决策：

```python
apply_first_round_decisions(
    state,
    adopted_client_keys=[...],
    rejected_client_keys=[...],
    graph_version=1,
)
```

该函数会：

1. 检查采用列表和拒绝列表不重叠；
2. 为 adopted 候选分配正式 `node_id`；
3. 把 adopted 候选转换为 `GraphNodeSnapshot`；
4. 只保留两端都已采用的候选支撑关系；
5. 重建完整 `GraphSnapshot`；
6. 同步更新 `CandidateRegistry`。

允许用户采用多个首轮候选，但只有 adopted 候选能够进入正式知识图谱。

### 3.2 生长候选

当前 Demo 将同一次生长产生的 3 个候选视为一个选择批次。

采用其中一个：

```python
adopt_growth_candidate(
    state,
    candidate_id="...",
    expected_graph_version=7,
)
```

处理结果：

- 选中候选标记为 `adopted`；
- 同批其余候选标记为 `rejected`；
- 新节点和新关系写入 `GraphSnapshot`；
- 图谱版本加一。

如果整批都不采用：

```python
reject_growth_candidates(
    state,
    expected_graph_version=7,
    rejection_reason="不符合当前故事",
)
```

此时会将整批候选标记为 `rejected`，但不修改正式图谱，也不增加图版本。

采用和拒绝操作都要求 `expected_graph_version` 与当前图版本一致，以防止前端基于旧图谱提交决策。

## 4. StoryState 设计

`SharedState` 中增加了完整的 `story` 子状态：

```python
class StoryState(TypedDict):
    request: StoryRequest
    context: StoryContext
    readiness: StoryReadiness
    plan: StoryPlan
    draft: StoryDraft
    validation: StoryValidation
    critique: StoryCritique
    repair_plan: StoryRepairPlan
    result: StoryResult
    repair_iteration: int
    max_repair_iterations: int
```

各字段职责：

| 字段 | 作用 |
|---|---|
| `request` | Story Run ID、基础图版本、标题要求 |
| `context` | adopted 节点、关系、Brief 硬约束和拒绝签名 |
| `readiness` | 生成前的图谱完备性检查 |
| `plan` | 带节点引用的 Story Beats |
| `draft` | 带溯源信息的 Story Segments |
| `validation` | 确定性校验结果 |
| `critique` | Critic 语义审查结果 |
| `repair_plan` | Beat 级修复指令 |
| `result` | 给 API 和前端返回的最终 Story |

新 Story Run 通过以下函数创建：

```python
create_story_run_state(
    state,
    story_run_id="story-run-001",
    title_instruction="国王水枪挑战",
    require_all_adopted_nodes=True,
    max_repair_iterations=1,
)
```

该函数会锁定当前图版本，并重置 Story 运行状态，但不会覆盖首轮候选、生长历史、候选决策账本或知识图谱快照。

## 5. Story LangGraph 工作流

Story 收敛使用独立 `StateGraph`：

```text
START
  -> validate_story_request
  -> build_story_context
  -> story_health_check
  -> story_planner
  -> story_writer
  -> story_validator
  -> story_critic
       -> 通过 -----------------> finalize_story -> END
       -> 不通过且未超限 -> story_repair
                                   -> story_validator
                                   -> story_critic
       -> 超过修复上限 -----> finalize_story -> END
```

所有 Agent 节点之间不直接调用，只能通过统一完整 `SharedState` 交换数据。

## 6. 各 Story 节点的职责

### 6.1 Request Validator

在任何模型调用前检查：

- 当前 State 是否处于 `story_convergence` 阶段；
- Story 基础图版本是否与当前图版本一致；
- 图谱中是否至少存在一个 adopted 节点；
- `candidate_registry.pending_ids` 是否为空。

如果失败，直接返回 `failed`，不调用大模型。

### 6.2 Context Builder

Context Builder 只从 `GraphSnapshot` 中复制：

```python
adopted_nodes
adopted_edges
```

同时加入：

- 推广对象；
- 核心主体；
- `must_keep` 和 `must_avoid`；
- 产品卖点；
- 发布平台、时长和风格；
- 首轮 Story Blueprint；
- 被拒绝候选的文本签名。

被拒绝候选只用于防止模型重复使用，不会作为可用故事设定传递给 Writer。

### 6.3 Health Check

在 Story Agent 真正开始生成前，检查 adopted 子图是否同时具备：

- 创意元素；
- 动机与冲突；
- 剧情事件；
- 产品或卖点引用。

如果缺少任一类，不允许模型自行虚构缺失节点，而是返回：

```text
needs_more_nodes
```

前端可以读取 `missing_story_functions`，引导用户回到节点生长界面补齐对应类型。

该节点还会检查孤立节点和时长容量。孤立节点默认只产生 warning，而节点过多、时长无法容纳时会阻止生成。

### 6.4 Story Planner

Planner 负责将 adopted 子图组织成 Story Beats。

每个 Beat 都必须声明：

```python
beat_id
phase
purpose
estimated_seconds
node_refs
relation_refs
product_feature_refs
planned_content
```

这样可以通过 `node_coverage` 直接判断某个 adopted 节点是否被忽略，不需要从最终自由文本中猜测。

### 6.5 Story Writer

Writer 根据 Story Plan 生成具体 Story Segments。

每个 Segment 都保留：

- 使用的图谱节点 ID；
- 使用的关系 ID；
- 体现的产品卖点；
- 分段预计时长；
- 具体故事文本。

因此最终故事可以反向溯源：

```text
某一段故事
  -> 使用了哪些节点
  -> 使用了哪些关系
  -> 体现了哪些产品卖点
```

### 6.6 Deterministic Validator

Validator 不调用模型，负责确定性硬规则校验：

- 是否覆盖所有 adopted 节点；
- 是否引用了未知或未采用节点；
- 是否引用了未采用关系；
- `used_node_ids` 是否与 Segment 的实际引用一致；
- 产品卖点引用是否来自 Brief；
- Segment 总时长是否与 Brief 时长一致；
- 是否生成 CTA；
- 是否出现 `must_avoid` 中的内容；
- 是否写入了被拒绝候选。

这些规则由程序判断，不依赖模型自我评价。

### 6.7 Story Critic

Critic 负责不适合用硬规则判断的语义质量，包括：

- adopted 节点覆盖率；
- 主体一致性；
- 剧情因果连贯性；
- 视频节奏；
- 产品融入程度；
- 风格符合度；
- 平台适配度；
- Brief 约束满足度。

Validator 产生的 error 会被强制合并进 Critic 结果。即使模型返回 `passed=true`，只要存在程序硬错误，系统仍然会强制判定不通过。

## 7. Beat 级局部修复

Critic 不直接改写 Story，而是生成 `StoryRepairPlan`：

```python
class StoryRepairPlan(TypedDict):
    preserve_beat_ids: list[str]
    rewrite_beat_ids: list[str]
    missing_node_ids: list[str]
    remove_unapproved_facts: list[str]
    instructions: list[str]
```

其中：

- `preserve_beat_ids` 表示已经合格、必须保留的 Beat；
- `rewrite_beat_ids` 表示允许重写的 Beat；
- `missing_node_ids` 表示被忽略、必须补回的 adopted 节点；
- `remove_unapproved_facts` 表示必须删除的未采用设定；
- `instructions` 保存具体修复指令。

Repair Agent 只能修改 `rewrite_beat_ids` 指定的部分，其他已通过的内容必须保留。

修复后会重新执行：

```text
Story Validator -> Story Critic
```

默认最多修复一次。如果超过修复上限仍然不通过，系统返回 `needs_review`，避免无限循环和无限 API 消耗。

## 8. StoryResult 输出

最终 `StoryResult` 包含：

```python
status
graph_version
title
logline
synopsis
full_script
cta
segments
used_node_ids
used_edge_ids
unused_adopted_node_ids
readiness
validation
critique
iteration_count
```

其中 `segments` 保留了每个剧情段落与知识图谱节点、关系和产品卖点之间的映射。

Story 最终状态包括：

| 状态 | 含义 |
|---|---|
| `ready` | Story 通过 Validator 和 Critic，可以使用 |
| `needs_more_nodes` | adopted 子图不完整，需要继续生长 |
| `needs_review` | 超过修复上限，需要人工处理 |
| `failed` | pending 候选、图版本或 State 阶段不合法 |

## 9. 不可变 State 实现

这一部分继续严格遵守统一不可变 `SharedState` 规则：

- 节点不允许修改传入的旧 State；
- 节点不允许只返回局部 Patch；
- 每个节点必须返回完整 `SharedState`；
- 嵌套字典和列表使用深拷贝；
- `rebuild_story()` 重建完整 Story 子状态；
- `rebuild_state()` 重建完整统一 State；
- 不使用 `MessagesState`、`add_messages` 或列表追加 Reducer。

例如 Story Planner 不会修改旧 State，而是先重建 Story，再重建完整 State：

```python
next_story = rebuild_story(
    state["story"],
    plan=new_plan,
)

return rebuild_state(
    state,
    story=next_story,
    current_stage="story_planned",
    messages=[*state["messages"], new_message],
)
```

## 10. 测试覆盖

当前自动化测试覆盖：

- `SharedState` 和 `StoryState` 字段完整性；
- 嵌套可变对象深拷贝；
- 所有 LangGraph 流式快照字段完整；
- 存在 pending 候选时不调用模型；
- 图谱版本过期时拒绝 Story 生成；
- 缺少任一节点类别时返回 `needs_more_nodes`；
- Story 覆盖全部 adopted 节点；
- rejected 候选无法进入最终 Story；
- adopted 生长节点会进入 Story；
- 整批拒绝生长候选后可继续 Story；
- Critic 可以触发一次 Beat 级局部修复。

当前共有 29 项自动化测试，全部通过。

## 11. 代码入口

| 文件 | 作用 |
|---|---|
| `src/creative_graph_agents/state.py` | CandidateRegistry、StoryState、决策 helper 和不可变 State 重建 |
| `src/creative_graph_agents/prompts.py` | Story Planner、Writer、Critic 和 Repair Prompt |
| `src/creative_graph_agents/story_nodes.py` | Story 业务节点、Validator、Critic、Repair 和路由 |
| `src/creative_graph_agents/story_workflow.py` | Story LangGraph 边和条件边 |
| `src/creative_graph_agents/model.py` | OpenAI-compatible 模型调用和 Story Mock |
| `examples/story_demo.py` | 候选决策到 Story 收敛的可运行示例 |
| `tests/test_story_workflow.py` | Story 流程与失败路径测试 |

## 12. 运行方式

Mock 模式不需要 API Key：

```powershell
cd python_agents
python examples\story_demo.py
```

使用 DeepSeek OpenAI-compatible 接口：

```powershell
$env:CREATIVE_MODEL_PROVIDER = "deepseek"
$env:OPENAI_API_KEY = "你的密钥"
$env:OPENAI_BASE_URL = "https://api.deepseek.com"
$env:OPENAI_MODEL = "deepseek-chat"
python examples\story_demo.py
```

## 13. 当前边界

- Python 层已完成领域 State 和 LangGraph 工作流，尚未增加 HTTP/SSE 路由；
- Demo 中的正式节点 ID 由本地 helper 生成，生产环境应改为数据库事务分配；
- 生长批次当前是“采用一个或整批拒绝”；
- Story 生成不会修改知识图谱；
- 如果用户修改图谱，必须基于新图版本创建新 Story Run。
