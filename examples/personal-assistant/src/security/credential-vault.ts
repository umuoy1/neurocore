import { randomUUID } from "node:crypto";

export interface CredentialSecretInput {
  ref: string;
  value: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
}

export interface ScopedCredentialLease {
  lease_id: string;
  secret_ref: string;
  scope: string;
  value: string;
  issued_at: string;
  expires_at: string;
  metadata: Record<string, unknown>;
}

export interface CredentialAuditEvent {
  event_id: string;
  event_type: "secret.registered" | "secret.leased" | "secret.denied";
  secret_ref: string;
  scope?: string;
  at: string;
  reason?: string;
}

export interface CredentialVault {
  registerSecret(input: CredentialSecretInput): string;
  hasSecret(ref: string): boolean;
  leaseSecret(ref: string, scope: string, options?: { ttlMs?: number; reason?: string }): ScopedCredentialLease;
  redact<T>(value: T): T;
  listAuditEvents(): CredentialAuditEvent[];
}

interface StoredSecret {
  value: string;
  scopes: Set<string>;
  metadata: Record<string, unknown>;
}

const DEFAULT_LEASE_TTL_MS = 60_000;
const SECRET_KEY_PATTERN = /token|secret|bearer|api[_-]?key|password|credential/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:sk|pk|xoxb|ghp|github_pat|ya29)[-_A-Za-z0-9]{8,}\b/g
];

export class InMemoryCredentialVault implements CredentialVault {
  private readonly secrets = new Map<string, StoredSecret>();
  private readonly auditEvents: CredentialAuditEvent[] = [];

  public registerSecret(input: CredentialSecretInput): string {
    if (!input.ref.trim()) {
      throw new Error("secret ref is required.");
    }
    if (!input.value) {
      throw new Error(`secret value is required for ${input.ref}.`);
    }
    if (input.scopes.length === 0) {
      throw new Error(`at least one scope is required for ${input.ref}.`);
    }

    this.secrets.set(input.ref, {
      value: input.value,
      scopes: new Set(input.scopes),
      metadata: input.metadata ?? {}
    });
    this.auditEvents.push({
      event_id: `cev_${randomUUID()}`,
      event_type: "secret.registered",
      secret_ref: input.ref,
      at: new Date().toISOString()
    });
    return input.ref;
  }

  public hasSecret(ref: string): boolean {
    return this.secrets.has(ref);
  }

  public leaseSecret(ref: string, scope: string, options: { ttlMs?: number; reason?: string } = {}): ScopedCredentialLease {
    const secret = this.secrets.get(ref);
    if (!secret) {
      this.auditEvents.push({
        event_id: `cev_${randomUUID()}`,
        event_type: "secret.denied",
        secret_ref: ref,
        scope,
        at: new Date().toISOString(),
        reason: "unknown_secret"
      });
      throw new Error(`Unknown secret ref: ${ref}`);
    }
    if (!isScopeAllowed(secret.scopes, scope)) {
      this.auditEvents.push({
        event_id: `cev_${randomUUID()}`,
        event_type: "secret.denied",
        secret_ref: ref,
        scope,
        at: new Date().toISOString(),
        reason: "scope_denied"
      });
      throw new Error(`Secret ${ref} is not authorized for scope ${scope}.`);
    }

    const issuedAt = new Date();
    const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    const lease = {
      lease_id: `cle_${randomUUID()}`,
      secret_ref: ref,
      scope,
      value: secret.value,
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + ttlMs).toISOString(),
      metadata: {
        ...secret.metadata,
        reason: options.reason
      }
    };
    this.auditEvents.push({
      event_id: `cev_${randomUUID()}`,
      event_type: "secret.leased",
      secret_ref: ref,
      scope,
      at: lease.issued_at,
      reason: options.reason
    });
    return lease;
  }

  public redact<T>(value: T): T {
    const knownSecrets = [...this.secrets.values()].map((secret) => secret.value);
    return redactCredentialSecrets(value, knownSecrets);
  }

  public listAuditEvents(): CredentialAuditEvent[] {
    return this.auditEvents.map((event) => ({ ...event }));
  }
}

export function redactCredentialSecrets<T>(value: T, knownSecrets: string[] = []): T {
  return redactNode(value, {
    path: "$",
    key: "",
    knownSecrets: knownSecrets.filter((secret) => secret.length > 0)
  }) as T;
}

export function isSecretLikeEnvKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function filterSecretEnv(
  env: Record<string, string> | undefined,
  allowedSecretKeys: string[] = []
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  const allowed = new Set(allowedSecretKeys);
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => allowed.has(key) || !isSecretLikeEnvKey(key))
  );
}

function isScopeAllowed(scopes: Set<string>, requestedScope: string): boolean {
  return scopes.has(requestedScope) || scopes.has("*") || [...scopes].some((scope) =>
    scope.endsWith(":*") && requestedScope.startsWith(scope.slice(0, -1))
  );
}

function redactNode(
  value: unknown,
  ctx: { path: string; key: string; knownSecrets: string[] }
): unknown {
  if (typeof value === "string") {
    return redactString(value, ctx.knownSecrets);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactNode(item, {
      ...ctx,
      key: String(index),
      path: `${ctx.path}[${index}]`
    }));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      SECRET_KEY_PATTERN.test(key)
        ? "[redacted]"
        : redactNode(nested, {
            ...ctx,
            key,
            path: `${ctx.path}.${key}`
          })
    ])
  );
}

function redactString(value: string, knownSecrets: string[]): string {
  let output = value;
  for (const secret of knownSecrets) {
    output = output.split(secret).join("[redacted]");
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output;
}
