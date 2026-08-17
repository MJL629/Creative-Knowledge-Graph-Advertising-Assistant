# 推送指引 & 团队协作指南

本仓库已完成本地 git 初始化（含完整初始提交），拿到后只需 3 条命令即可推到 GitHub 远程仓库。

## 一、推送到 GitHub（首次，仓库维护者执行）

```bash
cd Creative-Knowledge-Graph-Advertising-Assistant

# 1. 关联远程仓库（空仓库）
git remote add origin https://github.com/MJL629/Creative-Knowledge-Graph-Advertising-Assistant.git

# 2. 推送
git push -u origin main
```

> 推送时 GitHub 会要求认证：用户名填 GitHub 用户名，密码填 **Personal Access Token**（GitHub 已不支持账号密码推送）。
> Token 获取：GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，勾选 `repo` 权限即可。

## 二、队友加入（协作流程）

```bash
# 1. 克隆
git clone https://github.com/MJL629/Creative-Knowledge-Graph-Advertising-Assistant.git
cd Creative-Knowledge-Graph-Advertising-Assistant

# 2. 安装依赖
npm install

# 3. 配置环境变量（默认 mock 模式，无需 API Key 即可离线演示）
cp .env.example .env

# 4. 本地开发
npm run dev        # http://localhost:3000

# 5. 验证
npm run lint       # 代码检查
npm test           # 8 个测试用例
```

### 分支约定

| 分支 | 用途 |
|------|------|
| `main` | 稳定可演示版本，只接受 PR 合入 |
| `feat/<功能名>` | 功能开发分支，如 `feat/story-export` |
| `fix/<问题名>` | 缺陷修复分支 |

### 接入真实大模型（DeepSeek）

编辑 `.env`：

```env
CREATIVE_MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxxx
```

mock / deepseek 两种模式接口结构完全一致，前端无需任何改动。

## 三、目录结构速览

```
app/page.tsx                  # 前端主界面（图谱画布、节点状态机、会话恢复）
app/api/graph/diverge/        # 首轮候选生成 API
app/api/graph/grow/           # 节点生长 API
app/api/graph/relations/      # 关系推荐 API
app/api/graph/concept/        # 剧情收敛 API
lib/agents/graph-pipeline.ts  # 四 Agent 流水线（首轮/关系/收敛）
lib/agents/growth-pipeline.ts # 生长流水线
lib/agents/deepseek.ts        # LLM 统一入口（mock/deepseek 双模式）
lib/agents/mock-llm.ts        # mock 适配器（离线演示用）
tests/rendered-html.test.mjs  # 测试
```

## 四、当前已完成 / 待办

**已完成（P0 核心链路 + 第二梯队）**：四 Agent 流水线、4 条 API、mock/deepseek 双模式、节点四状态、需复核传播、两种删除、会话恢复、节点拖拽、层级整理。

**待办（下一梯队候选）**：
- [ ] 数据库接入（技术设计：PostgreSQL + pgvector / Cloudflare D1）
- [ ] RAG 检索模块（need_rag 已在 Supervisor 决策中预留）
- [ ] 记忆模块（need_memory 已预留）
- [ ] 外部工具调用（need_external_tool 已预留）
- [ ] 剧情导出（分镜表 / 脚本下载）
- [ ] React Flow 画布升级（替代当前自研画布）
