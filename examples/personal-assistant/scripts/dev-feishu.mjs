import { createPersonalAssistantConfigFromEnv, startPersonalAssistantApp } from "../dist/main.js";

const config = createPersonalAssistantConfigFromEnv();
config.web_chat = {
  ...(config.web_chat ?? {}),
  enabled: true
};
config.feishu = {
  ...(config.feishu ?? {}),
  enabled: true
};

const app = await startPersonalAssistantApp(config);
console.log("[personal-assistant:feishu] started");
console.log("[personal-assistant:feishu] Web Chat is also enabled for local debugging.");
console.log("[personal-assistant:feishu] Press Ctrl+C to stop.");

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
