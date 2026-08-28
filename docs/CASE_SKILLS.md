# Creative Case Skill 技术说明

## 目标

Creative Case Skill 用一组受控的案例模式卡替代默认 RAG 上下文，为首轮发散和节点生长提供可选 Few-shot 结构参考。它只迁移 Hook、冲突机制、叙事结构、卖点植入和 CTA 等抽象模式，不提供外部事实，也不会进入最终 Story 的事实来源。

核心业务边界：

- Brief、硬约束、推广主体和 adopted 图谱事实始终优先。
- Selector 最多选择两个互补模式；没有合适模式时返回空选择。
- 非法 ID、重复 ID 和不属于当前阶段的卡片由确定性代码过滤。
- Selector 失败时降级为空选择，Creative 继续基于 Brief 工作；用户主动取消仍向上抛出。
- Story 收敛只读取 adopted 节点与关系，不读取案例卡。

## 目录与唯一数据源

```text
python_agents/src/creative_graph_agents/
├─ skills/creative-case-patterns/
│  ├─ SKILL.md                    # 技能用途、触发条件和安全边界
│  └─ references/cases.json       # 唯一案例卡数据源
├─ case_skills.py                 # Python 目录读取与白名单解析
├─ nodes.py                       # Python Selector 节点
└─ prompts.py                     # Python 运行时 Prompt 约束

lib/agents/
├─ case-skills.ts                 # TypeScript 目录读取、选择和降级
├─ graph-pipeline.ts              # 首轮注入 CaseSkillContext
└─ growth-pipeline.ts             # 生长注入 CaseSkillContext
```

`cases.json` 是两套运行时共享的唯一案例数据源。TypeScript 直接静态导入该文件；Python 通过 `importlib.resources` 读取，`pyproject.toml` 会把 `SKILL.md` 与 JSON 一并打包。

`SKILL.md` 是技能契约和维护规范，应用运行时不会动态执行 Markdown。实际运行时只向 Selector 暴露 `cases.json` 的轻量 metadata，选择完成后再由确定性代码装载对应完整卡片；Prompt 中同步实现禁止照搬和事实边界。

## 执行流程

```text
Brief / Growth Request
        │
        ▼
Supervisor：规划上下文，不选择案例
        │
        ▼
Case Skill Selector
  1. 读取当前阶段的轻量目录
  2. 返回 0～2 个 skill_id 与选择理由
        │
        ▼
Resolver（确定性）
  - 阶段白名单
  - ID 白名单
  - 去重与数量上限
  - 深拷贝完整 example
        │
        ▼
Creative / Critic
  - 只迁移抽象机制
  - 检查案例照搬风险
        │
        ▼
候选节点 → 人工采用/排除
```

首轮结果中会返回 `caseSkillContext`（TypeScript）或写入统一完整 State 的 `case_skill_context`（Python）。选择器不会直接生成节点，也不能更改图谱正式状态。

## 与 RAG 的关系

Case Skill 是默认的创意上下文机制。RAG 保留为兼容路径，只有调用方显式传入 `needRag=true` 时才执行；系统不会因为 Brief 缮信息而自动打开检索。

二者职责不同：

| 机制 | 适合解决 | 是否可当事实 |
|---|---|---|
| Case Skill | 结构、Hook、冲突、节奏和 CTA 模式 | 否 |
| RAG | 需要来源的品牌资料、产品知识或外部事实 | 仅经来源与规则校验后 |

## 配置

TypeScript 服务默认自动选择：

```env
CREATIVE_CASE_SKILL_MODE=auto
```

设置为 `disabled` 可进行无 Few-shot 对照实验。Python 工作流也支持在 Brief 中传入：

```json
{
  "caseSkillMode": "disabled"
}
```

## 添加案例卡

只修改 `references/cases.json`，不要在 TypeScript 和 Python 中复制一份卡片：

1. 使用唯一、稳定的 `skill_id`。
2. 明确 `stages`：`initial`、`growth` 或两者。
3. `triggers` 只写用于选择的品类、平台、受众或叙事线索。
4. `example` 描述抽象模式，不放真实品牌机密或待复制文案。
5. 填写 `do_not_copy`，指出容易被误抄的具体元素。
6. 运行 Skill 校验、TypeScript 单元测试和 Python 测试。

## 验证命令

```powershell
npm run test:unit
npx tsc --noEmit

cd python_agents
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Skill 目录还应通过 `skill-creator/scripts/quick_validate.py`，并在构建 Python wheel 后确认 `SKILL.md` 与 `references/cases.json` 均已包含。
