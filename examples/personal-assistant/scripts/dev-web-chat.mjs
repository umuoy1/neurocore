import { createPersonalAssistantConfigFromEnv, startPersonalAssistantApp } from "../dist/main.js";

const config = createPersonalAssistantConfigFromEnv();
config.web_chat = {
  ...(config.web_chat ?? {}),
  enabled: true
};
config.feishu = {
  ...(config.feishu ?? {}),
  enabled: false
};

const app = await startPersonalAssistantApp(config);
console.log("[personal-assistant:web] started");
console.log(
  `[personal-assistant:web] http://${config.web_chat?.host ?? "127.0.0.1"}:${config.web_chat?.port ?? 3301}/`
);
console.log(
  `[personal-assistant:web] ws://${config.web_chat?.host ?? "127.0.0.1"}:${config.web_chat?.port ?? 3301}${config.web_chat?.path ?? "/chat"}`
);
console.log("[personal-assistant:web] Press Ctrl+C to stop.");

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
