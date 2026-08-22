# D 部署方案

> 目标：在 8 月 31 日前得到一个可公开访问的 Demo 链接，用于比赛提交和演示。
> 当前约束：正式模式强制 PostgreSQL；比赛演示可以先使用 mock 模型，不依赖 DeepSeek Key。

## 1. 方案对比

| 方案 | 成本 | 国内可访问性 | 工作量 | 说明 |
|---|---|---|---|---|
| A. Node 服务 + 云 PostgreSQL（推荐） | 低 | 中（选国内云更好） | 1 天 | 与现有代码最匹配：`npm run build && npm start` |
| B. Cloudflare Workers + D1 | 低 | 中 | 1-2 天 | 代码已有 Worker 入口，但还需接 D1/迁移适配 |
| C. 本地 + 录屏兜底 | 无 | 无 | 0.5 天 | 只用于评审现场，不满足“线上可访问”要求 |

**推荐 A**：用 Neon 免费 PostgreSQL + Railway / Render / 国内轻量云服务器部署，改动最少，最容易在提交前跑通。

## 2. 方案 A：Node 服务 + PostgreSQL

### 2.1 准备 PostgreSQL

1. 注册 Neon（https://neon.tech）并创建数据库，拿到连接串：
   `postgres://user:password@host/dbname?sslmode=require`
2. 复制一份给 `DATABASE_URL`，一份给 `WORKFLOW_DATABASE_URL`（可以指向同一个库，不同 schema 也行）。
3. 生产环境不要使用 `PERSISTENCE_PROVIDER=memory`。

### 2.2 部署平台配置

以 Railway / Render 为例，创建 Node 服务，指向仓库 `main` 或评审后的合并分支。

构建命令：

```bash
npm ci
npm run db:migrate
npm run build
```

启动命令：

```bash
npm start
```

### 2.3 环境变量

```env
NODE_ENV=production
PERSISTENCE_PROVIDER=postgres
DATABASE_URL=postgres://...
WORKFLOW_CHECKPOINTER=postgres
WORKFLOW_DATABASE_URL=postgres://...
WORKFLOW_CHECKPOINT_SCHEMA=langgraph
CREATIVE_MODEL_PROVIDER=mock
RETRIEVAL_PROVIDER=mock
```

如果要在演示中使用真实 DeepSeek，再把 `CREATIVE_MODEL_PROVIDER` 改为 `deepseek`，并加入：

```env
OPENAI_API_KEY=sk-xxxx
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

不要使用 `NEXT_PUBLIC_` 或 `VITE_` 前缀，避免密钥进入浏览器。

### 2.4 验证

部署后访问：

```bash
curl https://你的域名/api/health
```

期望返回 `persistence: "postgres"`、`workflow: "ok"`、`modelProvider: "configured"`。再完整走一遍《疯狂水世界》演示路径。

## 3. 方案 B：Cloudflare Workers（可选）

项目已经包含 `worker/index.ts` 和 Cloudflare Vite 插件，适合用 Cloudflare 部署，但还需要：

1. 在 `.openai/hosting.json` 或 Wrangler 配置中接入数据库；
2. 把 PostgreSQL 连接配置为平台 Secrets；
3. 确认 LangGraph PostgreSQL checkpointer 在 Worker 运行时可连接外网数据库（可能需要 Hyperdrive 或外部 PG）；
4. 跑迁移并验证 `/api/health`。

如果时间紧张，优先做方案 A；方案 B 留作后续优化。

## 4. 国内可访问性

- Railway / Render 的域名在国内不一定稳定，评审访问可能慢。
- 如果团队有国内云服务器（腾讯云/阿里云轻量），建议把 Node 服务部署到国内，绑定备案域名或用临时公网 IP。
- 比赛材料中同时保留：线上链接、3 分钟录屏、本地 mock 演示三个兜底。

## 5. 提交前部署检查清单

- [ ] `/api/health` 返回 `persistence=postgres`
- [ ] 刷新页面后项目可恢复（换浏览器也能看到同一项目）
- [ ] mock 模式全流程跑通（无 API Key）
- [ ] 若用 DeepSeek：连续 10 次全流程无结构化解析报错
- [ ] 环境变量未暴露在页面代码或 Git 历史
- [ ] 线上链接写入商业计划书和报名材料
- [ ] 部署账号凭据只有团队成员知道，不用主人 Token 部署
