# Personal Assistant Example

`examples/personal-assistant/` 是基于 NeuroCore Runtime 的独立个人助理示例应用。

当前实现重点：

- Web Chat 入口
- 飞书 Adapter 骨架
- SQLite 持久化 session 路由
- Web Search / Web Browser 工具
- Proactive Engine 最小骨架

推荐启动方式：

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
  "web_chat": {
    "host": "127.0.0.1",
    "port": 3301,
    "path": "/chat"
  }
}
```

其中模型配置文件继续沿用仓库现有的 OpenAI Compatible JSON 格式：

```json
{
  "provider": "openai-compatible",
  "model": "your-model-name",
  "apiUrl": "https://your-openai-compatible-endpoint",
  "bearerToken": "your-token",
  "timeoutMs": 60000
}
```

常用环境变量：

- `PERSONAL_ASSISTANT_DB_PATH`
- `PERSONAL_ASSISTANT_TENANT_ID`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `BRAVE_SEARCH_API_KEY`
- `WEB_CHAT_PORT`
- `WEB_CHAT_HOST`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

本地调试入口：

- 浏览器页面：`http://127.0.0.1:3301/`
- WebSocket 端点：`ws://127.0.0.1:3301/chat`

页面会直接连接 `WebChatAdapter`，不是额外的 mock server。保持相同的 `chat_id` 可以复用同一条会话路由。
