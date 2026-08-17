# 后续优化路线图

> 基于 PRD 初版 + 技术细节设计对照当前实现（P0 核心链路 + 第二梯队已完成）梳理。
> 优先级依据：**P0 = 演示/交付必需，P1 = 产品完整度，P2 = 体验增强**。
> 冲突处理原则：PRD 与技术设计冲突时，以技术设计细节为第一优先级。

## 现状基线（已完成）

| 能力 | 状态 |
|------|------|
| 四 Agent 流水线（Supervisor/Creative/Critic/Story） | ✅ mock 全流程跑通 |
| 4 条 API（diverge/grow/relations/concept） | ✅ 含输入校验、引用校验 |
| LLM 双模式（mock/deepseek） | 🟡 代码就绪，deepseek 待真实 Key 实测 |
| 节点四状态 + 需复核传播 + 两种删除 + 会话恢复 | ✅ |
| 节点拖拽 / 层级整理 / 深度与重要性字段 | ✅ |
| 测试 | ✅ 8/8 通过，lint 0 错误 |

---

## P0-1 数据库接入（最大缺口，建议首先做）

**背景**：当前会话持久化靠 localStorage（FR-11），换浏览器/设备即丢失，且无法多人协作、无法做历史版本（FR-17）。技术设计指定 PostgreSQL + pgvector；当前脚手架预留了 Cloudflare D1（`db/index.ts`）。

**方案建议（二选一）**：

| 维度 | 方案 A：Cloudflare D1 | 方案 B：PostgreSQL + pgvector |
|------|----------------------|------------------------------|
| 与现有代码契合度 | 高（db/index.ts 已写好 D1 接入） | 中（需换 ORM 连接串） |
| 向量检索（RAG 前置） | 需另配 Vectorize | pgvector 原生支持，一步到位 |
| 部署成本 | 低（Cloudflare 全家桶） | 中（需自建/托管 PG） |
| 适合阶段 | 快速上线演示 | 长期演进（技术设计倾向此项） |

**建议**：演示期用 D1 快速落地（表结构一致），RAG 启动时迁 PostgreSQL + pgvector（技术设计为准）。

**核心表设计草案**：
```
projects(id, brief jsonb, created_at)
nodes(id, project_id, label, desc, status, depth, importance, position jsonb, parent_id, created_at)
edges(id, project_id, source_id, target_id, label, status, created_at)
story_outputs(id, project_id, concept jsonb, created_at)
sessions(id, project_id, user_id, snapshot jsonb, updated_at)  -- 会话快照，替代 localStorage
```

**验收标准**：刷新/换浏览器后项目可完整恢复；两个浏览器打开同一项目看到相同数据。

**工作量估计**：D1 路线 1~2 天；PG 路线 2~3 天（含迁移脚本）。

## P0-2 真实 Key 实测 deepseek 模式 + Prompt 调优

**背景**：deepseek 调用代码已就绪（OpenAI 兼容接口 + `json_object` 结构化输出），但从未用真实 Key 跑过。mock 结果好不代表真实模型输出稳定。

**实施步骤**：
1. `.env` 填入真实 `DEEPSEEK_API_KEY`，`CREATIVE_MODEL_PROVIDER=deepseek`
2. 全流程走一遍：首轮发散 → 生长 → 关系推荐 → 剧情收敛
3. 重点观察：
   - Supervisor 决策的 `context_plan`/`risk_flags` 是否合理（是否出现幻觉字段）
   - JSON 解析失败率（json_object 模式偶发不合法 JSON，需重试机制）
   - Creative 候选与产品 brief 的相关性、去重率
4. 按观察结果迭代 `lib/agents/graph-pipeline.ts` 里的 system prompt

**验收标准**：连续 10 次全流程无结构化解析报错；候选相关性感观上可接受。

**工作量估计**：0.5 天实测 + 视情况 0.5~2 天 Prompt 迭代。

## P1-1 RAG 检索模块（创意知识图谱的"知识"来源）

**背景**：`need_rag` 开关已在 Supervisor Structured Decision 中预留（技术设计 4.1），但无实现。PRD 定位的核心卖点——"创意知识图谱"需要外部创意素材库（爆款案例、行业钩子、平台特性）支撑发散。

**实施步骤**：
1. 选 PostgreSQL + pgvector（技术设计指定）
2. 素材入库：爆款短视频拆解（钩子类型/情绪曲线/结构模式）向量化存储
3. `lib/agents/` 新增 `rag.ts`：当 `decision.need_rag === true` 时，用 brief 语义检索 top-k 素材注入 Creative 的上下文
4. 检索结果在 UI 标注来源（哪个案例启发了该候选）

**验收标准**：同一 brief 开/关 RAG 对比，开启后候选明显更具体、有案例依据。

**工作量估计**：3~5 天（含素材库整理）。

## P1-2 记忆模块（跨会话用户偏好）

**背景**：`need_memory` 已预留。记住用户历史采用/排除模式，让推荐越用越准。

**要点**：
- 依赖 P0-1 数据库（历史数据落库）
- 记录：用户采用了哪类钩子、排除哪类情绪、偏好节奏
- Supervisor 决策时把用户画像注入 context_plan

**工作量估计**：2~3 天（依赖 P0-1）。

## P1-3 剧情导出（PRD 交付物格式）

**背景**：当前剧情收敛结果只在页面展示（FR-13 之后的部分）。创作者需要拿走可用成果。

**要点**：
- 分镜表导出（CSV/Excel：镜头号/画面描述/台词/时长/refs）
- 脚本文档导出（Markdown/Word）
- 导出前强制执行引用校验（已有逻辑复用）

**工作量估计**：1~2 天。

## P1-4 多用户与协作基础

**背景**：团队协作场景（你的明确诉求）需要：项目归属、只读分享、编辑权限。

**要点**：
- 最小方案：匿名 session id + 项目分享链接（只读）
- 完整方案：GitHub OAuth / 账号体系 + 实时协同（可后置）

**工作量估计**：最小方案 1~2 天；完整方案 1~2 周（建议后置到 P2）。

## P2-1 React Flow 画布升级

**背景**：自研画布已支持拖拽/层级整理，但缩放、框选、小地图、撤销重做、自动受力布局等能力自研成本高。技术设计指定 React Flow。

**要点**：节点/边数据结构已按图模型设计，迁移映射成本低；注意保留节点四状态样式与需复核视觉标记。

**工作量估计**：2~3 天。

## P2-2 外部工具调用（need_external_tool）

**背景**：开关已预留。典型场景：查竞品广告库、拉取平台热榜、素材合规检查。

**工作量估计**：视接入的工具而定，单个工具 1~2 天。

## P2-3 LLM 成本与性能治理

**要点**：
- 请求合并（Supervisor+Creative 单次往返）
- 候选缓存（相同 brief+参数命中缓存）
- 流式输出（用户等待感优化，SSE）

**工作量估计**：2~3 天。

---

## 建议排期（两人协作）

| 周次 | 人员 A | 人员 B |
|------|--------|--------|
| W1 | P0-1 数据库（D1） | P0-2 真实 Key 实测 + Prompt 调优 |
| W2 | P1-3 剧情导出 | P1-1 RAG 素材库整理与入库 |
| W3 | P1-1 RAG 检索接入 | P2-1 React Flow 升级 |
| W4 | P1-2 记忆模块 | P1-4 分享链接（最小方案） |

> 排期假设两人全职；数据库先行是因为 RAG/记忆/协作全部依赖它。
