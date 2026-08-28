# Python LangGraph 多 Agent 创意图谱工作流

该子项目实现一条独立的首轮创意发散链路：多个分析 Agent 通过同一个完整 `SharedState` 交换结构化结果，随后由 Creative 统一生成 Story Blueprint 与三类候选，再由 Validator 和 Critic 进入最多两次的局部修复循环。

首轮链路现在还包含可选的 Creative Case Skill Selector：Selector 只读取轻量案例目录，最多选择两个结构模式，再把对应 Few-shot 卡片写入 `state.case_skill_context`。案例只提供 Hook、冲突、结构、卖点植入和 CTA 的抽象参考，不是事实来源。

在首轮结果之上，子项目还实现了受控节点生长：选择一个已采用节点，指定六种生长方向之一、生成类型和可选补充要求，生成三个具有独立 run 命名空间的新候选。生长结果存放在 `state.growth`，不会覆盖首轮六个候选。

首轮 Story Blueprint 是候选内容的共同叙事假设，不是正式 Story。现在已实现正式 Story 收敛：候选全部决策完成后，只从 adopted 子图生成带节点溯源的 Story，并经过确定性 Validator、Critic 和 Beat 级 Repair。

如果需要先向队友介绍整体设计、各 Agent 分工和数据流，请阅读 [`B部分-首轮多Agent工作流说明.md`](./B部分-首轮多Agent工作流说明.md)。

生长 State、六方向 Prompt、冲突检测和采用闭环见 [`生长节点实现说明.md`](./生长节点实现说明.md)。

候选逐个决策、只读 adopted 子图、Story 溯源和修复流程见 [`Story收敛流程与技术说明.md`](./Story收敛流程与技术说明.md)。

如果只需要向队友快速介绍这一部分，可以直接阅读 [`候选决策与Story生成技术实现总结.md`](./候选决策与Story生成技术实现总结.md)。

## 不可变状态约束

LangGraph 1.2.10 的官方默认语义是：没有 reducer 的普通字段采用覆盖更新，节点可以只返回局部更新。本项目主动施加更严格的规则：

- `SharedState` 直接继承 `TypedDict`，不使用 `MessagesState`。
- 不使用 `add_messages`、`operator.add` 或其他字段 reducer。
- 初始 State 一次性初始化全部字段。
- 每个节点返回全部 State 字段。
- `rebuild_state()` 深拷贝所有可变字段，并拒绝未知字段。
- `@immutable_full_state_node` 在运行时检查节点没有修改输入，且没有复用顶层可变容器。
- 测试检查所有流式 State 快照都拥有完整字段。

由于每个节点都会返回全部字段且没有 reducer，多个节点不能在同一个 LangGraph superstep 并发写入 State，否则会产生并发更新冲突。因此四个分析 Agent 按显式边顺序执行。它们仍是相互独立的节点，不直接调用，只通过 State 通信。

## 工作流

```text
START
  -> normalize_brief
  -> supervisor
  -> select_case_skills
  -> subject_analyst
  -> advertising_analyst
  -> conflict_analyst
  -> narrative_analyst
  -> creative
  -> validator
  -> critic
       -> pass -------------------------------> finalize -> END
       -> fail && iteration < max_iterations -> creative_repair
                                                  -> validator
                                                  -> critic
       -> fail && limit reached -------------> finalize -> END
```

各 Agent 的职责：

| 节点 | 写入 State 的主要结果 | 不负责 |
|---|---|---|
| Supervisor | 分析计划、上下文计划、风险 | 不生成候选 |
| Case Skill Selector | 从轻量目录选择 0~2 个 Few-shot 案例模式 | 不生成节点、不把案例当事实 |
| Subject Analyst | 主体、人物能动性、主体漂移风险 | 不生成正式人物节点 |
| Advertising Analyst | 卖点、产品叙事功能、广告风险 | 不写 Story |
| Conflict Analyst | 目标、阻碍、代价、升级路径 | 不生成正式冲突节点 |
| Narrative Analyst | HOOK、发展、转折、高潮、CTA 节奏 | 不生成正式事件节点 |
| Creative | Story Blueprint、三类各两个候选、候选支撑关系 | 不生成数据库字段 |
| Validator | 数量、分类、引用、时长、禁止项等确定性校验 | 不做语义评价 |
| Critic | 多维评分、问题和 Repair Plan | 不直接改写草稿 |
| Creative Repair | 按 Repair Plan 局部修改 | 不修改无关候选 |

## 目录

```text
python_agents/
├─ src/creative_graph_agents/
│  ├─ state.py       # SharedState、全部子结构和不可变重建
│  ├─ model.py       # Mock / OpenAI-compatible JSON 模型
│  ├─ prompts.py     # Agent Prompt
│  ├─ case_skills.py # 案例技能目录加载、白名单解析和按需装载
│  ├─ skills/creative-case-patterns/
│  │  ├─ SKILL.md
│  │  └─ references/cases.json
│  ├─ nodes.py       # 独立业务节点、Validator 和条件路由
│  ├─ workflow.py    # StateGraph 边和条件边
│  ├─ growth_nodes.py      # 六方向生长、冲突校验和修复节点
│  ├─ growth_workflow.py   # 单次节点生长 StateGraph
│  ├─ story_nodes.py       # Story 投影、健康检查、校验、Critic 和 Repair
│  ├─ story_workflow.py    # adopted 子图 Story StateGraph
│  └─ cli.py         # 命令行示例
├─ examples/
│  ├─ brief.json
│  ├─ growth_demo.py
│  └─ story_demo.py
├─ tests/
└─ pyproject.toml
```

## 安装

要求 Python 3.10 以上，推荐 3.12。

Windows PowerShell：

```powershell
cd python_agents
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
```

## Mock 模式运行

Mock 是默认模式，不需要 API Key：

```powershell
$env:CREATIVE_MODEL_PROVIDER = "mock"
creative-graph-agents --brief examples\brief.json
```

输出包括：

- `story_hypothesis`
- 六个候选节点，三个分类各两个
- 候选之间的语义支撑关系
- Critic 评分与问题
- 最终状态 `ready_for_selection | needs_review | failed`

默认自动选择案例技能。若调用方希望做无 Few-shot 对照实验，可在 Brief 中加入：

```json
{
  "caseSkillMode": "disabled"
}
```

自动模式的选择结果保存在完整共享 State：

```json
{
  "case_skill_context": {
    "catalog_version": "creative-case-patterns-v1",
    "selection_mode": "auto",
    "selected": [
      {
        "skill_id": "royal-water-battle",
        "title": "身份规则化多人对战",
        "reason": "Brief 命中多人游戏与身份反转模式",
        "stages": ["initial", "growth"],
        "example": {}
      }
    ]
  }
}
```

首轮分析、Creative、Repair、Critic 以及后续 Growth 可以读取所选模式；正式 Story 收敛不读取案例技能，只以 adopted 图谱为事实来源。

需要查看完整共享 State：

```powershell
creative-graph-agents --brief examples\brief.json --full-state
```

运行一次完整的“首轮生成 → 采用种子 → 节点生长”：

```powershell
python examples\growth_demo.py
```

运行“首轮生成 → 全部候选决策 → adopted 子图 Story 收敛”：

```powershell
python examples\story_demo.py
```

## DeepSeek 模式

DeepSeek 使用标准 OpenAI-compatible `/chat/completions` 请求格式：

```powershell
$env:CREATIVE_MODEL_PROVIDER = "deepseek"
$env:OPENAI_API_KEY = "你的密钥"
$env:OPENAI_BASE_URL = "https://api.deepseek.com"
$env:OPENAI_MODEL = "deepseek-chat"
creative-graph-agents --brief examples\brief.json
```

不要把真实 `.env`、API Key 或数据库凭据提交到仓库。

## 测试

```powershell
python -m unittest discover -s tests -v
```

测试覆盖：

- 初始 State 字段完整性
- 案例技能目录只暴露轻量 metadata，完整卡片按选择加载
- 非法 skill ID 与重复选择会被过滤，超过两个选择时确定性截断
- `caseSkillMode=disabled` 不调用 Skill Selector 模型
- 嵌套可变对象深拷贝
- 未知 State 字段拒绝
- 节点不修改旧 State
- 每个节点返回完整 State
- 三类候选数量
- Critic 条件路由和 Repair Loop
- Repair 次数上限
- 非法 Brief 的错误结束路径
- 所有 LangGraph 流式快照字段完整
- 首轮六个候选在生长过程中保持不变
- 六种生长方向及目标分类解析
- 不兼容方向在模型调用前失败
- 首轮重复候选检测
- Growth Critic 局部修复循环
- 过期图谱版本拒绝采用
- 采用生长候选后继续第二轮生长
- 待决候选和过期图版本在模型调用前被拦截
- 缺少任一创意类别时返回 `needs_more_nodes`
- Story 覆盖全部 adopted 节点且不使用 rejected 候选
- Story Critic 按 Beat 定点修复
- 生长批次整批拒绝后可继续 Story 收敛

## 接入现有系统

推荐把这条 Python Workflow 部署为 B 侧内部服务，并继续遵守现有 `CreativeAgentGateway` 业务边界：

```text
TypeScript Workflow/API
  -> CreativeAgentGateway.initialDivergence() / growNode() / convergeStory()
  -> Python first-round / growth / story StateGraph
  -> InitialDivergenceResult / GrowthResult / StoryResult
```

Python State 中不保存数据库客户端、模型客户端、Repository 或用户密钥。模型适配器通过构建图时的依赖注入传入，Agent 之间的业务数据只存在于 `SharedState`。
