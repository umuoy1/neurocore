import type { IncomingMessage } from "node:http";

export interface AuthContext {
  tenant_id: string;
  api_key_id: string;
  permissions: string[];
  role?: string;
}

export interface Authenticator {
  authenticate(req: IncomingMessage): Promise<AuthContext | null>;
}

export interface ApiKeyEntry {
  tenant_id: string;
  permissions: string[];
  role?: string;
}

export class ApiKeyAuthenticator implements Authenticator {
  private readonly keys: Map<string, ApiKeyEntry>;

  public constructor(keys: Map<string, ApiKeyEntry>) {
    this.keys = keys;
  }

  public async authenticate(req: IncomingMessage): Promise<AuthContext | null> {
    const key = this.extractKey(req);
    if (!key) {
      return null;
    }

    const entry = this.keys.get(key);
    if (!entry) {
      return null;
    }

    return {
      tenant_id: entry.tenant_id,
      api_key_id: key,
      permissions: entry.permissions,
      role: entry.role
    };
  }

  private extractKey(req: IncomingMessage): string | undefined {
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }

    const apiKeyHeader = req.headers["x-api-key"];
    if (typeof apiKeyHeader === "string" && apiKeyHeader.trim().length > 0) {
      return apiKeyHeader.trim();
    }

    return undefined;
  }
}
