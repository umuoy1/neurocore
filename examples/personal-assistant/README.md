# Personal Assistant Example

`examples/personal-assistant/` 是基于 NeuroCore Runtime 的独立个人助理示例应用。

当前实现重点：

- Web Chat 入口
- 飞书 Adapter 骨架
- SQLite 持久化 session 路由
- Web Search / Web Browser 工具
- Proactive Engine 最小骨架

推荐产品化启动方式：

1. `npm run build`
2. `node scripts/neurocore.mjs assistant setup --home "$HOME" --port 3301`
3. `node scripts/neurocore.mjs assistant start --home "$HOME"`
4. 打开 `http://127.0.0.1:3301/`

常用管理命令：

- `node scripts/neurocore.mjs assistant status --home "$HOME"`
- `node scripts/neurocore.mjs assistant stop --home "$HOME"`
- `node scripts/neurocore.mjs assistant install-daemon --home "$HOME"`

兼容的本地开发启动方式：

1. `npm run build`
2. `node examples/personal-assistant/scripts/dev-web-chat.mjs`
3. 打开 `http://127.0.0.1:3301/`

配置加载顺序：

1. 进程环境变量
2. `.neurocore/.personal-assistant/app.local.json`
3. `.neurocore/.personal-assistant/llm.local.json`
4. 根目录 `.neurocore/llm.local.json`

推荐把 personal assistant 的局部配置放在 `.neurocore/.personal-assistant/`：

```json
{
  "db_path": ".neurocore/personal-assistant.sqlite",
  "tenant_id": "local",
  "agent": {
    "auto_approve": true
  },
  "web_chat": {
    "host": "127.0.0.1",
    "port": 3301,
    "path": "/chat"
  }
}
```

`agent.auto_approve: true` 会在启动时关闭人工审批升级，让高副作用动作直接执行，适合本地调试或受控环境。

其中模型配置文件继续沿用仓库现有的 OpenAI Compatible JSON 格式：

```json
{
  "provider": "openai-compatible",
  "model": "your-model-name",
  "apiUrl": "https://your-openai-compatible-endpoint",
  "bearerToken": "your-token",
  "timeoutMs": 180000,
  "jsonTimeoutMs": 45000,
  "streamTimeoutMs": 180000,
  "extraBody": {
    "enable_thinking": false
  }
}
```

硅基流动等 OpenAI-compatible 服务在大模型或长回复场景下首包可能超过 60 秒，建议把最终回复的 `timeoutMs` / `streamTimeoutMs` 或环境变量 `OPENAI_TIMEOUT_MS` / `OPENAI_STREAM_TIMEOUT_MS` 设置为 `180000` 以上。结构化 plan/respond 阶段建议保留较短的 `jsonTimeoutMs` / `OPENAI_JSON_TIMEOUT_MS`，个人助理默认是 `45000`，避免一次对话被三次慢调用串行拖住。

常用环境变量：

- `PERSONAL_ASSISTANT_DB_PATH`
- `PERSONAL_ASSISTANT_TENANT_ID`
- `PERSONAL_ASSISTANT_AUTO_APPROVE`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_MS`
- `OPENAI_JSON_TIMEOUT_MS`
- `OPENAI_STREAM_TIMEOUT_MS`
- `BRAVE_SEARCH_API_KEY`
- `WEB_CHAT_PORT`
- `WEB_CHAT_HOST`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

本地调试入口：

- 浏览器页面：`http://127.0.0.1:3301/`
- WebSocket 端点：`ws://127.0.0.1:3301/chat`

页面会直接连接 `WebChatAdapter`，不是额外的 mock server。保持相同的 `chat_id` 可以复用同一条会话路由。
