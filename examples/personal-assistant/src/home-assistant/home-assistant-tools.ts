import type { JsonValue, Tool } from "@neurocore/protocol";

export type HomeAssistantAuditEventType =
  | "entity_discovered"
  | "state_read"
  | "service_dry_run"
  | "service_blocked"
  | "service_called"
  | "state_readback"
  | "service_failed";

export interface HomeAssistantEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistantServiceCallResult {
  entity_id: string;
  domain: string;
  service: string;
  status: "dry_run" | "blocked" | "completed" | "failed";
  dangerous: boolean;
  requires_approval: boolean;
  state_before?: HomeAssistantEntity;
  state_after?: HomeAssistantEntity;
  response?: Record<string, unknown>;
  error?: string;
  audit_id: string;
}

export interface HomeAssistantAuditEvent {
  audit_id: string;
  event_type: HomeAssistantAuditEventType;
  entity_id?: string;
  domain?: string;
  service?: string;
  actor_id?: string;
  created_at: string;
  metadata: Record<string, JsonValue>;
}

export interface HomeAssistantClient {
  listEntities(): Promise<HomeAssistantEntity[]>;
  readState(entityId: string): Promise<HomeAssistantEntity | undefined>;
  callService(input: {
    domain: string;
    service: string;
    entity_id: string;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

export interface HomeAssistantRestClientOptions {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
}

export class HomeAssistantRestClient implements HomeAssistantClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: HomeAssistantRestClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  public async listEntities(): Promise<HomeAssistantEntity[]> {
    const response = await this.request("/api/states", { method: "GET" });
    if (!Array.isArray(response)) {
      throw new Error("Home Assistant states response must be an array.");
    }
    return response.map(readEntity);
  }

  public async readState(entityId: string): Promise<HomeAssistantEntity | undefined> {
    const response = await this.request(`/api/states/${encodeURIComponent(entityId)}`, {
      method: "GET",
      allowNotFound: true
    });
    return response ? readEntity(response) : undefined;
  }

  public async callService(input: {
    domain: string;
    service: string;
    entity_id: string;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const response = await this.request(`/api/services/${encodeURIComponent(input.domain)}/${encodeURIComponent(input.service)}`, {
      method: "POST",
      body: JSON.stringify({
        entity_id: input.entity_id,
        ...input.data
      })
    });
    return readRecord(response);
  }

  private async request(path: string, init: RequestInit & { allowNotFound?: boolean }): Promise<unknown | undefined> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });
    if (response.status === 404 && init.allowNotFound) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`Home Assistant request failed: ${response.status} ${await response.text()}`);
    }
    const text = await response.text();
    return text.length > 0 ? JSON.parse(text) : {};
  }
}

export interface PersonalHomeAssistantServiceOptions {
  client: HomeAssistantClient;
  dangerousServices?: string[];
  now?: () => string;
  generateId?: (prefix: string) => string;
}

export class PersonalHomeAssistantService {
  private readonly dangerousServices: Set<string>;
  private readonly now: () => string;
  private readonly generateId: (prefix: string) => string;
  private readonly auditEvents: HomeAssistantAuditEvent[] = [];
  private sequence = 0;

  public constructor(private readonly options: PersonalHomeAssistantServiceOptions) {
    this.dangerousServices = new Set(options.dangerousServices ?? defaultDangerousServices());
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? ((prefix) => {
      this.sequence += 1;
      return `${prefix}_${this.sequence.toString().padStart(6, "0")}`;
    });
  }

  public async discoverEntities(input: { domain?: string; query?: string } = {}): Promise<HomeAssistantEntity[]> {
    const entities = (await this.options.client.listEntities())
      .filter((entity) => !input.domain || getEntityDomain(entity.entity_id) === input.domain)
      .filter((entity) => !input.query || entity.entity_id.includes(input.query) || JSON.stringify(entity.attributes).toLowerCase().includes(input.query.toLowerCase()));
    this.audit("entity_discovered", {
      metadata: {
        count: entities.length,
        domain: input.domain ?? null,
        query: input.query ?? null
      }
    });
    return entities;
  }

  public async readState(input: { entity_id: string; actor_id?: string }): Promise<HomeAssistantEntity | undefined> {
    const entityId = readRequiredString(input.entity_id, "entity_id");
    const entity = await this.options.client.readState(entityId);
    this.audit("state_read", {
      entity_id: entityId,
      domain: getEntityDomain(entityId),
      actor_id: input.actor_id,
      metadata: {
        found: Boolean(entity),
        state: entity?.state ?? null
      }
    });
    return entity;
  }

  public async callService(input: {
    entity_id: string;
    domain?: string;
    service: string;
    data?: Record<string, unknown>;
    dry_run?: boolean;
    approved?: boolean;
    actor_id?: string;
  }): Promise<HomeAssistantServiceCallResult> {
    const entityId = readRequiredString(input.entity_id, "entity_id");
    const domain = input.domain ?? getEntityDomain(entityId);
    const service = readRequiredString(input.service, "service");
    const data = input.data ?? {};
    const dangerous = this.isDangerous(domain, service);
    const requiresApproval = dangerous;
    const stateBefore = await this.options.client.readState(entityId);

    if (input.dry_run === true) {
      const audit = this.audit("service_dry_run", {
        entity_id: entityId,
        domain,
        service,
        actor_id: input.actor_id,
        metadata: {
          dangerous,
          requires_approval: requiresApproval,
          data: data as JsonValue,
          state_before: stateBefore as unknown as JsonValue
        }
      });
      return {
        entity_id: entityId,
        domain,
        service,
        status: "dry_run",
        dangerous,
        requires_approval: requiresApproval,
        state_before: stateBefore,
        audit_id: audit.audit_id
      };
    }

    if (dangerous && input.approved !== true) {
      const audit = this.audit("service_blocked", {
        entity_id: entityId,
        domain,
        service,
        actor_id: input.actor_id,
        metadata: {
          reason: "approval_required",
          state_before: stateBefore as unknown as JsonValue
        }
      });
      return {
        entity_id: entityId,
        domain,
        service,
        status: "blocked",
        dangerous,
        requires_approval: true,
        state_before: stateBefore,
        error: "Dangerous Home Assistant service calls require dry_run=true first and approved=true before execution.",
        audit_id: audit.audit_id
      };
    }

    try {
      const response = await this.options.client.callService({
        domain,
        service,
        entity_id: entityId,
        data
      });
      const stateAfter = await this.options.client.readState(entityId);
      const audit = this.audit("service_called", {
        entity_id: entityId,
        domain,
        service,
        actor_id: input.actor_id,
        metadata: {
          dangerous,
          approved: input.approved === true,
          response: response as JsonValue,
          state_before: stateBefore as unknown as JsonValue,
          state_after: stateAfter as unknown as JsonValue
        }
      });
      this.audit("state_readback", {
        entity_id: entityId,
        domain,
        service,
        actor_id: input.actor_id,
        metadata: {
          state: stateAfter?.state ?? null,
          audit_parent_id: audit.audit_id
        }
      });
      return {
        entity_id: entityId,
        domain,
        service,
        status: "completed",
        dangerous,
        requires_approval: requiresApproval,
        state_before: stateBefore,
        state_after: stateAfter,
        response,
        audit_id: audit.audit_id
      };
    } catch (error) {
      const audit = this.audit("service_failed", {
        entity_id: entityId,
        domain,
        service,
        actor_id: input.actor_id,
        metadata: {
          dangerous,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      return {
        entity_id: entityId,
        domain,
        service,
        status: "failed",
        dangerous,
        requires_approval: requiresApproval,
        state_before: stateBefore,
        error: error instanceof Error ? error.message : String(error),
        audit_id: audit.audit_id
      };
    }
  }

  public listAuditEvents(input: { limit?: number; entity_id?: string } = {}): HomeAssistantAuditEvent[] {
    return this.auditEvents
      .filter((event) => !input.entity_id || event.entity_id === input.entity_id)
      .slice(-(input.limit ?? 50))
      .map((event) => ({
        ...event,
        metadata: { ...event.metadata }
      }))
      .reverse();
  }

  private isDangerous(domain: string, service: string): boolean {
    return this.dangerousServices.has(`${domain}.${service}`) || this.dangerousServices.has(service);
  }

  private audit(
    eventType: HomeAssistantAuditEventType,
    input: Omit<HomeAssistantAuditEvent, "audit_id" | "event_type" | "created_at" | "metadata"> & { metadata?: Record<string, JsonValue> }
  ): HomeAssistantAuditEvent {
    const event: HomeAssistantAuditEvent = {
      event_type: eventType,
      audit_id: this.generateId("ha_audit"),
      created_at: this.now(),
      metadata: input.metadata ?? {},
      entity_id: input.entity_id,
      domain: input.domain,
      service: input.service,
      actor_id: input.actor_id
    };
    this.auditEvents.push(event);
    return event;
  }
}

export function createHomeAssistantTools(service: PersonalHomeAssistantService): Tool[] {
  return [
    {
      name: "home_assistant_entity_discover",
      description: "Discover Home Assistant entities by domain or query.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string" },
          query: { type: "string" }
        }
      },
      async invoke(input) {
        const entities = await service.discoverEntities({
          domain: readOptionalString(input.domain),
          query: readOptionalString(input.query)
        });
        return {
          summary: `Discovered ${entities.length} Home Assistant entit${entities.length === 1 ? "y" : "ies"}.`,
          payload: { entities: entities as unknown as JsonValue }
        };
      }
    },
    {
      name: "home_assistant_state_read",
      description: "Read a Home Assistant entity state.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          entity_id: { type: "string" },
          actor_id: { type: "string" }
        },
        required: ["entity_id"]
      },
      async invoke(input) {
        const entity = await service.readState({
          entity_id: readRequiredString(input.entity_id, "entity_id"),
          actor_id: readOptionalString(input.actor_id)
        });
        return {
          summary: entity ? `${entity.entity_id} is ${entity.state}.` : "Home Assistant entity was not found.",
          payload: { entity: entity as unknown as JsonValue }
        };
      }
    },
    {
      name: "home_assistant_service_call",
      description: "Call a Home Assistant service. Dangerous calls require dry_run=true first and approved=true before execution.",
      sideEffectLevel: "high",
      inputSchema: {
        type: "object",
        properties: {
          entity_id: { type: "string" },
          domain: { type: "string" },
          service: { type: "string" },
          data: { type: "object" },
          dry_run: { type: "boolean" },
          approved: { type: "boolean" },
          actor_id: { type: "string" }
        },
        required: ["entity_id", "service"]
      },
      async invoke(input, ctx) {
        const result = await service.callService({
          entity_id: readRequiredString(input.entity_id, "entity_id"),
          domain: readOptionalString(input.domain),
          service: readRequiredString(input.service, "service"),
          data: readRecord(input.data),
          dry_run: input.dry_run === true,
          approved: input.approved === true,
          actor_id: readOptionalString(input.actor_id) ?? ctx.session_id
        });
        return {
          summary: formatServiceCallSummary(result),
          payload: { result: result as unknown as JsonValue }
        };
      }
    },
    {
      name: "home_assistant_audit_list",
      description: "List Home Assistant discovery, dry-run, service call and state readback audit events.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          entity_id: { type: "string" }
        }
      },
      async invoke(input) {
        const events = service.listAuditEvents({
          limit: readOptionalNumber(input.limit),
          entity_id: readOptionalString(input.entity_id)
        });
        return {
          summary: `Listed ${events.length} Home Assistant audit event${events.length === 1 ? "" : "s"}.`,
          payload: { events: events as unknown as JsonValue }
        };
      }
    }
  ];
}

function formatServiceCallSummary(result: HomeAssistantServiceCallResult): string {
  if (result.status === "dry_run") {
    return `Dry-run ${result.domain}.${result.service} for ${result.entity_id}; approval required=${result.requires_approval}.`;
  }
  if (result.status === "blocked") {
    return `Blocked ${result.domain}.${result.service} for ${result.entity_id}: ${result.error}`;
  }
  if (result.status === "completed") {
    return `Executed ${result.domain}.${result.service} for ${result.entity_id}; state=${result.state_after?.state ?? "unknown"}.`;
  }
  return `Failed ${result.domain}.${result.service} for ${result.entity_id}: ${result.error ?? "unknown error"}.`;
}

function readEntity(value: unknown): HomeAssistantEntity {
  const record = readRecord(value);
  return {
    entity_id: readRequiredString(record.entity_id, "entity_id"),
    state: readRequiredString(record.state, "state"),
    attributes: readRecord(record.attributes),
    last_changed: readOptionalString(record.last_changed),
    last_updated: readOptionalString(record.last_updated)
  };
}

function getEntityDomain(entityId: string): string {
  const [domain] = entityId.split(".");
  if (!domain) {
    throw new Error(`Home Assistant entity_id must include a domain: ${entityId}`);
  }
  return domain;
}

function defaultDangerousServices(): string[] {
  return [
    "turn_on",
    "turn_off",
    "toggle",
    "lock",
    "unlock",
    "open_cover",
    "close_cover",
    "set_temperature",
    "press",
    "start",
    "stop"
  ];
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
