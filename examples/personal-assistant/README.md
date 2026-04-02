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
