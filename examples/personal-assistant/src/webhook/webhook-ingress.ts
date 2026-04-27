import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { normalizePersonalIngressMessage } from "../im-gateway/ingress.js";
import type { IMPlatform, UnifiedMessage } from "../im-gateway/types.js";
import { BackgroundTaskLedger } from "../proactive/background-task-ledger.js";

export type WebhookRouteTarget = "session" | "task";

export interface PersonalWebhookRouteConfig {
  id: string;
  path: string;
  token: string;
  target: WebhookRouteTarget;
  platform?: IMPlatform;
  chat_id?: string;
  sender_id?: string;
  target_user?: string;
  description?: string;
}

export interface PersonalWebhookRequest {
  method: string;
  path: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface PersonalWebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface PersonalWebhookAuditEvent {
  event_id: string;
  route_id?: string;
  status: "accepted" | "rejected";
  reason?: string;
  target?: WebhookRouteTarget | "gmail_pubsub";
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface PersonalWebhookIngressOptions {
  routes: PersonalWebhookRouteConfig[];
  handleMessage?: (message: UnifiedMessage) => Promise<void>;
  taskLedger?: BackgroundTaskLedger;
  now?: () => string;
}

export class PersonalWebhookIngress {
  public readonly taskLedger: BackgroundTaskLedger;
  private readonly routes = new Map<string, PersonalWebhookRouteConfig>();
  private readonly auditEvents: PersonalWebhookAuditEvent[] = [];
  private readonly now: () => string;

  public constructor(private readonly options: PersonalWebhookIngressOptions) {
    for (const route of options.routes) {
      this.routes.set(route.path, route);
    }
    this.taskLedger = options.taskLedger ?? new BackgroundTaskLedger();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async handle(request: PersonalWebhookRequest): Promise<PersonalWebhookResponse> {
    if (request.method.toUpperCase() !== "POST") {
      return this.reject(undefined, "method_not_allowed", 405, { method: request.method });
    }
    const route = this.routes.get(request.path);
    if (!route) {
      return this.reject(undefined, "unknown_route", 404, { path: request.path });
    }
    if (!isAuthorized(route.token, request.headers ?? {})) {
      return this.reject(route, "unauthorized", 401, {});
    }
    const payload = parsePayload(request.body);
    if (route.target === "task") {
      const task = this.taskLedger.create({
        source: "webhook",
        description: route.description ?? `Webhook ${route.id}`,
        target_user: route.target_user ?? route.sender_id ?? "webhook",
        target_platform: route.platform,
        metadata: {
          webhook_route_id: route.id,
          payload,
          untrusted_content: true,
          untrusted_reason: webhookUntrustedReason(route.id)
        }
      });
      this.audit(route, "accepted", "task_created", { task_id: task.task_id });
      return {
        status: 202,
        body: {
          accepted: true,
          route_id: route.id,
          target: "task",
          task_id: task.task_id
        }
      };
    }
    if (!this.options.handleMessage) {
      return this.reject(route, "message_handler_not_configured", 500, {});
    }
    const message = buildWebhookMessage(route, payload, this.now());
    await this.options.handleMessage(message);
    this.audit(route, "accepted", "message_routed", { message_id: message.message_id });
    return {
      status: 202,
      body: {
        accepted: true,
        route_id: route.id,
        target: "session",
        message_id: message.message_id
      }
    };
  }

  public listAuditEvents(): PersonalWebhookAuditEvent[] {
    return this.auditEvents.map((event) => structuredClone(event));
  }

  private reject(
    route: PersonalWebhookRouteConfig | undefined,
    reason: string,
    status: number,
    metadata: Record<string, unknown>
  ): PersonalWebhookResponse {
    this.audit(route, "rejected", reason, metadata);
    return {
      status,
      body: {
        accepted: false,
        route_id: route?.id,
        reason
      }
    };
  }

  private audit(
    route: PersonalWebhookRouteConfig | undefined,
    status: PersonalWebhookAuditEvent["status"],
    reason: string,
    metadata: Record<string, unknown>
  ): void {
    this.auditEvents.push({
      event_id: `wha_${this.auditEvents.length + 1}`,
      route_id: route?.id,
      status,
      reason,
      target: route?.target,
      created_at: this.now(),
      metadata
    });
  }
}

export interface GmailPubSubWebhookAdapterOptions {
  token: string;
  handleMessage: (message: UnifiedMessage) => Promise<void>;
  platform?: IMPlatform;
  chat_id?: string;
  sender_id?: string;
  now?: () => string;
}

export class GmailPubSubWebhookAdapter {
  private readonly auditEvents: PersonalWebhookAuditEvent[] = [];
  private readonly now: () => string;

  public constructor(private readonly options: GmailPubSubWebhookAdapterOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async handlePush(request: PersonalWebhookRequest): Promise<PersonalWebhookResponse> {
    if (request.method.toUpperCase() !== "POST") {
      return this.reject("method_not_allowed", 405, {});
    }
    if (!isAuthorized(this.options.token, request.headers ?? {})) {
      return this.reject("unauthorized", 401, {});
    }
    const payload = parsePayload(request.body);
    const data = decodePubSubData(payload);
    const message = normalizePersonalIngressMessage({
      message_id: asString(payload.message_id) ?? asString((payload.message as Record<string, unknown> | undefined)?.messageId) ?? `gmail-${Date.now()}`,
      platform: this.options.platform ?? "email",
      chat_id: this.options.chat_id ?? asString(data.emailAddress) ?? "gmail-pubsub",
      sender_id: this.options.sender_id ?? asString(data.emailAddress) ?? "gmail-pubsub",
      timestamp: this.now(),
      content: {
        type: "markdown",
        text: [
          "UNTRUSTED_GMAIL_PUBSUB_EVENT",
          `emailAddress: ${asString(data.emailAddress) ?? "unknown"}`,
          `historyId: ${asString(data.historyId) ?? "unknown"}`
        ].join("\n")
      },
      metadata: {
        gmail_pubsub: data,
        raw_pubsub: payload,
        untrusted_content: true,
        untrusted_reason: "Gmail Pub/Sub push payload is an external event and must be treated as untrusted."
      },
      channel: {
        metadata: {
          transport: "gmail_pubsub",
          untrusted_content: true
        }
      },
      identity: {
        trust_level: "unknown",
        metadata: {
          untrusted_content: true
        }
      }
    });
    await this.options.handleMessage(message);
    this.auditEvents.push({
      event_id: `gha_${this.auditEvents.length + 1}`,
      status: "accepted",
      reason: "gmail_pubsub_routed",
      target: "gmail_pubsub",
      created_at: this.now(),
      metadata: {
        message_id: message.message_id,
        emailAddress: data.emailAddress,
        historyId: data.historyId
      }
    });
    return {
      status: 202,
      body: {
        accepted: true,
        target: "gmail_pubsub",
        message_id: message.message_id,
        gmail: data
      }
    };
  }

  public listAuditEvents(): PersonalWebhookAuditEvent[] {
    return this.auditEvents.map((event) => structuredClone(event));
  }

  private reject(reason: string, status: number, metadata: Record<string, unknown>): PersonalWebhookResponse {
    this.auditEvents.push({
      event_id: `gha_${this.auditEvents.length + 1}`,
      status: "rejected",
      reason,
      target: "gmail_pubsub",
      created_at: this.now(),
      metadata
    });
    return {
      status,
      body: {
        accepted: false,
        reason
      }
    };
  }
}

function buildWebhookMessage(
  route: PersonalWebhookRouteConfig,
  payload: Record<string, unknown>,
  now: string
): UnifiedMessage {
  return normalizePersonalIngressMessage({
    message_id: asString(payload.message_id) ?? `webhook-${route.id}-${Date.now()}`,
    platform: route.platform ?? "web",
    chat_id: route.chat_id ?? `webhook:${route.id}`,
    sender_id: route.sender_id ?? `webhook:${route.id}`,
    timestamp: now,
    content: {
      type: "markdown",
      text: [
        "UNTRUSTED_WEBHOOK_PAYLOAD",
        `Route: ${route.id}`,
        "",
        JSON.stringify(payload, null, 2)
      ].join("\n")
    },
    metadata: {
      webhook_route_id: route.id,
      payload,
      untrusted_content: true,
      untrusted_reason: webhookUntrustedReason(route.id)
    },
    channel: {
      route_key: `webhook:${route.id}`,
      metadata: {
        transport: "webhook",
        route_id: route.id,
        untrusted_content: true,
        untrusted_reason: webhookUntrustedReason(route.id)
      }
    },
    identity: {
      trust_level: "unknown",
      metadata: {
        untrusted_content: true,
        webhook_route_id: route.id
      }
    }
  });
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return parsePayload(parsed);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function decodePubSubData(payload: Record<string, unknown>): Record<string, unknown> {
  const message = payload.message;
  const data = message && typeof message === "object" && !Array.isArray(message)
    ? (message as Record<string, unknown>).data
    : undefined;
  if (typeof data !== "string") {
    return {};
  }
  const decoded = Buffer.from(data, "base64").toString("utf8");
  return parsePayload(decoded);
}

function isAuthorized(expected: string, headers: Record<string, string | string[] | undefined>): boolean {
  const token = readHeader(headers, "x-neurocore-webhook-token")
    ?? readHeader(headers, "x-webhook-token")
    ?? parseBearer(readHeader(headers, "authorization"));
  if (!token) {
    return false;
  }
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function parseBearer(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function webhookUntrustedReason(routeId: string): string {
  return `Webhook route ${routeId} receives external payloads that can be spoofed or adversarial.`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
