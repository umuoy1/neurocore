import type { WebSearchConfig } from "../connectors/types.js";
import { InMemoryCredentialVault, type CredentialVault } from "../security/credential-vault.js";
import type { PersonalAssistantAppConfig, PersonalAssistantModelProviderConfig, PersonalAssistantOpenAIConfig } from "./assistant-config.js";

export const MODEL_DEFAULT_SECRET_REF = "personal-assistant://model/default/bearer-token";
export const WEB_SEARCH_SECRET_REF = "personal-assistant://tool/web_search/api-key";

export function createPersonalAssistantCredentialVault(
  config: PersonalAssistantAppConfig,
  existing?: CredentialVault
): CredentialVault {
  const vault = existing ?? new InMemoryCredentialVault();
  registerModelSecrets(config, vault);
  registerSearchSecret(config.connectors?.search, vault);
  registerChannelSecrets(config, vault);
  return vault;
}

export function resolveModelBearerToken(
  vault: CredentialVault | undefined,
  provider: PersonalAssistantOpenAIConfig | PersonalAssistantModelProviderConfig,
  providerId = "default"
): string {
  const ref = provider.bearerTokenRef ?? modelSecretRef(providerId);
  if (vault?.hasSecret(ref)) {
    return vault.leaseSecret(ref, `model:${providerId}`, { reason: "model_provider" }).value;
  }
  if (provider.bearerToken) {
    return provider.bearerToken;
  }
  throw new Error(`Missing model credential for provider ${providerId}.`);
}

export function resolveWebSearchConfig(
  config: WebSearchConfig,
  vault: CredentialVault | undefined
): WebSearchConfig {
  const ref = config.apiKeyRef ?? WEB_SEARCH_SECRET_REF;
  if (vault?.hasSecret(ref)) {
    return {
      ...config,
      apiKey: undefined,
      apiKeyRef: ref,
      credentialVault: vault,
      credentialScope: "tool:web_search"
    };
  }
  return config;
}

export function leaseChannelSecret(
  vault: CredentialVault | undefined,
  ref: string,
  scope: string,
  fallback: string | undefined
): string | undefined {
  if (vault?.hasSecret(ref)) {
    return vault.leaseSecret(ref, scope, { reason: "channel_adapter" }).value;
  }
  return fallback;
}

export function modelSecretRef(providerId: string): string {
  return `personal-assistant://model/${providerId}/bearer-token`;
}

export function channelSecretRef(channel: string, name: string): string {
  return `personal-assistant://channel/${channel}/${name}`;
}

function registerModelSecrets(config: PersonalAssistantAppConfig, vault: CredentialVault): void {
  if (config.openai?.bearerToken) {
    registerIfMissing(vault, config.openai.bearerTokenRef ?? MODEL_DEFAULT_SECRET_REF, config.openai.bearerToken, ["model:default"]);
  }
  for (const provider of config.models?.providers ?? []) {
    if (provider.bearerToken) {
      registerIfMissing(vault, provider.bearerTokenRef ?? modelSecretRef(provider.id), provider.bearerToken, [`model:${provider.id}`]);
    }
  }
}

function registerSearchSecret(config: WebSearchConfig | undefined, vault: CredentialVault): void {
  if (!config?.apiKey) {
    return;
  }
  registerIfMissing(vault, config.apiKeyRef ?? WEB_SEARCH_SECRET_REF, config.apiKey, ["tool:web_search"]);
}

function registerChannelSecrets(config: PersonalAssistantAppConfig, vault: CredentialVault): void {
  if (config.feishu?.app_secret) {
    registerIfMissing(vault, config.feishu.app_secret_ref ?? channelSecretRef("feishu", "app_secret"), config.feishu.app_secret, ["channel:feishu"]);
  }
  if (config.telegram?.bot_token) {
    registerIfMissing(vault, config.telegram.bot_token_ref ?? channelSecretRef("telegram", "bot_token"), config.telegram.bot_token, ["channel:telegram"]);
  }
  if (config.telegram?.webhook_secret) {
    registerIfMissing(vault, config.telegram.webhook_secret_ref ?? channelSecretRef("telegram", "webhook_secret"), config.telegram.webhook_secret, ["channel:telegram"]);
  }
  if (config.slack?.bot_token) {
    registerIfMissing(vault, config.slack.bot_token_ref ?? channelSecretRef("slack", "bot_token"), config.slack.bot_token, ["channel:slack"]);
  }
  if (config.slack?.signing_secret) {
    registerIfMissing(vault, config.slack.signing_secret_ref ?? channelSecretRef("slack", "signing_secret"), config.slack.signing_secret, ["channel:slack"]);
  }
  if (config.discord?.bot_token) {
    registerIfMissing(vault, config.discord.bot_token_ref ?? channelSecretRef("discord", "bot_token"), config.discord.bot_token, ["channel:discord"]);
  }
}

function registerIfMissing(
  vault: CredentialVault,
  ref: string,
  value: string,
  scopes: string[]
): void {
  if (vault.hasSecret(ref)) {
    return;
  }
  vault.registerSecret({
    ref,
    value,
    scopes
  });
}
