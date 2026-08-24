# Story Revise 接口契约（AI 微调助手）

> 状态：前端 UI 已预留，接口待技术同学实现。
> 前端调用点：`lib/client/api-client.ts` 的 `reviseStory()`；结果页“AI 微调助手”面板。

## 端点

`POST /api/story/revise`

## 请求

```json
{
  "story": { "concept": "...", "theme": "...", "beats": [] },
  "instruction": "让前 3 秒冲突更强，但不要增加拍摄角色",
  "adoptedNodes": [],
  "adoptedEdges": []
}
```

字段说明：

- `story`：当前完整 `StoryConcept`（可编辑后的最新值）。
- `instruction`：用户修改指令，必填，非空。
- `adoptedNodes` / `adoptedEdges`：已采用子图，用于约束修改范围，可选。

## 响应

```json
{
  "ok": true,
  "result": {
    "before": { "concept": "...", "beats": [] },
    "after": { "concept": "...", "beats": [] },
    "changes": [
      { "path": "beats[0].text", "before": "旧文案", "after": "新文案" }
    ]
  }
}
```

约定：

- `before` / `after` 都是完整 `StoryConcept`，方便前端整体预览和保存。
- `changes` 是结构化变更点，用于“部分接受”按字段勾选。
- AI 只能修改语义内容，不生成数据库字段、ID、状态或版本号。
- 未触及已采用图谱事实时，返回空 `changes` 或明确说明。

## mock 模式建议

`CREATIVE_MODEL_PROVIDER=mock` 时也应可用，建议根据指令关键词做确定性改写：

- 含“节奏更快/加快” → 把首个 beat 文案改为“3 秒内建立冲突”。
- 含“反转更强” → 增强转折 beat 的措辞。
- 含“卖点更自然” → 修改卖点植入文案。
- 含“降低成本” → 在拍摄建议中减少场景/角色数量表述。
- 其他指令 → 返回 `changes: []`，`after` 与 `before` 相同。

## 错误

非 2xx 响应统一使用现有 envelope：

```json
{
  "ok": false,
  "error": { "code": "STORY_REVISE_FAILED", "message": "human readable message" }
}
```

前端在接口未实现时会显示“AI 微调服务尚未接入”，不会白屏。
