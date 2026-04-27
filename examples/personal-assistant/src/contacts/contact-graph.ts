import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { JsonValue, Tool } from "@neurocore/protocol";
import type { EmailSendProvider } from "../connectors/types.js";

export type ContactTrustLevel = "trusted" | "known" | "external" | "blocked";
export type ContactConfirmationPolicy = "never" | "trusted" | "always";

export interface PersonalContact {
  contact_id: string;
  user_id: string;
  display_name: string;
  aliases: string[];
  email?: string;
  organization_id?: string;
  role?: string;
  trust_level: ContactTrustLevel;
  default_memory_scope?: string;
  status: "active" | "deleted";
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface PersonalOrganization {
  organization_id: string;
  user_id: string;
  name: string;
  aliases: string[];
  domain?: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface PersonalChannelIdentity {
  channel_identity_id: string;
  user_id: string;
  contact_id: string;
  platform: string;
  handle: string;
  trust_level: ContactTrustLevel;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface PersonalRelationship {
  relationship_id: string;
  user_id: string;
  contact_id: string;
  relationship_type: string;
  label?: string;
  trust_level: ContactTrustLevel;
  memory_scope?: string;
  confirmation_policy: ContactConfirmationPolicy;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface ContactResolution {
  status: "resolved" | "ambiguous" | "not_found";
  query: string;
  contact?: PersonalContact;
  candidates: PersonalContact[];
  relationship?: PersonalRelationship;
  reason: string;
  memory_scope?: string;
  requires_confirmation: boolean;
}

export interface ContactMessageConfirmation {
  status: "ready" | "confirmation_required" | "clarification_required" | "blocked";
  query: string;
  recipient_email?: string;
  contact_id?: string;
  display_name?: string;
  memory_scope?: string;
  reason: string;
  candidates: PersonalContact[];
}

export interface ContactGraphStore {
  upsertOrganization(input: Partial<PersonalOrganization> & { user_id: string; name: string }): PersonalOrganization;
  upsertContact(input: Partial<PersonalContact> & { user_id: string; display_name: string }): PersonalContact;
  upsertChannelIdentity(input: Partial<PersonalChannelIdentity> & { user_id: string; contact_id: string; platform: string; handle: string }): PersonalChannelIdentity;
  upsertRelationship(input: Partial<PersonalRelationship> & { user_id: string; contact_id: string; relationship_type: string }): PersonalRelationship;
  listOrganizations(userId: string): PersonalOrganization[];
  listContacts(userId: string): PersonalContact[];
  listRelationships(userId: string): PersonalRelationship[];
  listChannelIdentities(userId: string): PersonalChannelIdentity[];
  getContact(userId: string, contactId: string): PersonalContact | undefined;
  close?(): void;
}

export interface SqliteContactGraphStoreOptions {
  filename: string;
}

export class SqliteContactGraphStore implements ContactGraphStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteContactGraphStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_contact_organizations (
        organization_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        domain TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personal_contacts (
        contact_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        email TEXT,
        organization_id TEXT,
        role TEXT,
        trust_level TEXT NOT NULL,
        default_memory_scope TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personal_contact_channel_identities (
        channel_identity_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        trust_level TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personal_contact_relationships (
        relationship_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        label TEXT,
        trust_level TEXT NOT NULL,
        memory_scope TEXT,
        confirmation_policy TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_contacts_user_status
        ON personal_contacts(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_personal_contact_relationships_user_type
        ON personal_contact_relationships(user_id, relationship_type);
      CREATE INDEX IF NOT EXISTS idx_personal_contact_channels_user_platform
        ON personal_contact_channel_identities(user_id, platform, handle);
    `);
  }

  public upsertOrganization(input: Partial<PersonalOrganization> & { user_id: string; name: string }): PersonalOrganization {
    const now = new Date().toISOString();
    const organization: PersonalOrganization = {
      organization_id: input.organization_id ?? `org_${randomUUID()}`,
      user_id: input.user_id,
      name: input.name,
      aliases: input.aliases ?? [],
      domain: input.domain,
      created_at: input.created_at ?? now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };
    this.db.prepare(`
      INSERT INTO personal_contact_organizations (
        organization_id, user_id, name, aliases_json, domain, created_at, updated_at, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        name = excluded.name,
        aliases_json = excluded.aliases_json,
        domain = excluded.domain,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      organization.organization_id,
      organization.user_id,
      organization.name,
      JSON.stringify(organization.aliases),
      organization.domain ?? null,
      organization.created_at,
      organization.updated_at,
      JSON.stringify(organization.metadata)
    );
    return organization;
  }

  public upsertContact(input: Partial<PersonalContact> & { user_id: string; display_name: string }): PersonalContact {
    const now = new Date().toISOString();
    const contact: PersonalContact = {
      contact_id: input.contact_id ?? `ct_${randomUUID()}`,
      user_id: input.user_id,
      display_name: input.display_name,
      aliases: input.aliases ?? [],
      email: input.email,
      organization_id: input.organization_id,
      role: input.role,
      trust_level: input.trust_level ?? "known",
      default_memory_scope: input.default_memory_scope,
      status: input.status ?? "active",
      created_at: input.created_at ?? now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };
    this.db.prepare(`
      INSERT INTO personal_contacts (
        contact_id, user_id, display_name, aliases_json, email, organization_id, role,
        trust_level, default_memory_scope, status, created_at, updated_at, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contact_id) DO UPDATE SET
        display_name = excluded.display_name,
        aliases_json = excluded.aliases_json,
        email = excluded.email,
        organization_id = excluded.organization_id,
        role = excluded.role,
        trust_level = excluded.trust_level,
        default_memory_scope = excluded.default_memory_scope,
        status = excluded.status,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      contact.contact_id,
      contact.user_id,
      contact.display_name,
      JSON.stringify(contact.aliases),
      contact.email ?? null,
      contact.organization_id ?? null,
      contact.role ?? null,
      contact.trust_level,
      contact.default_memory_scope ?? null,
      contact.status,
      contact.created_at,
      contact.updated_at,
      JSON.stringify(contact.metadata)
    );
    return contact;
  }

  public upsertChannelIdentity(input: Partial<PersonalChannelIdentity> & { user_id: string; contact_id: string; platform: string; handle: string }): PersonalChannelIdentity {
    const now = new Date().toISOString();
    const identity: PersonalChannelIdentity = {
      channel_identity_id: input.channel_identity_id ?? `chi_${randomUUID()}`,
      user_id: input.user_id,
      contact_id: input.contact_id,
      platform: input.platform,
      handle: input.handle,
      trust_level: input.trust_level ?? "known",
      created_at: input.created_at ?? now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };
    this.db.prepare(`
      INSERT INTO personal_contact_channel_identities (
        channel_identity_id, user_id, contact_id, platform, handle, trust_level, created_at, updated_at, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_identity_id) DO UPDATE SET
        platform = excluded.platform,
        handle = excluded.handle,
        trust_level = excluded.trust_level,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      identity.channel_identity_id,
      identity.user_id,
      identity.contact_id,
      identity.platform,
      identity.handle,
      identity.trust_level,
      identity.created_at,
      identity.updated_at,
      JSON.stringify(identity.metadata)
    );
    return identity;
  }

  public upsertRelationship(input: Partial<PersonalRelationship> & { user_id: string; contact_id: string; relationship_type: string }): PersonalRelationship {
    const now = new Date().toISOString();
    const relationship: PersonalRelationship = {
      relationship_id: input.relationship_id ?? `rel_${randomUUID()}`,
      user_id: input.user_id,
      contact_id: input.contact_id,
      relationship_type: input.relationship_type,
      label: input.label,
      trust_level: input.trust_level ?? "known",
      memory_scope: input.memory_scope,
      confirmation_policy: input.confirmation_policy ?? "trusted",
      created_at: input.created_at ?? now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };
    this.db.prepare(`
      INSERT INTO personal_contact_relationships (
        relationship_id, user_id, contact_id, relationship_type, label, trust_level, memory_scope,
        confirmation_policy, created_at, updated_at, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(relationship_id) DO UPDATE SET
        contact_id = excluded.contact_id,
        relationship_type = excluded.relationship_type,
        label = excluded.label,
        trust_level = excluded.trust_level,
        memory_scope = excluded.memory_scope,
        confirmation_policy = excluded.confirmation_policy,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      relationship.relationship_id,
      relationship.user_id,
      relationship.contact_id,
      relationship.relationship_type,
      relationship.label ?? null,
      relationship.trust_level,
      relationship.memory_scope ?? null,
      relationship.confirmation_policy,
      relationship.created_at,
      relationship.updated_at,
      JSON.stringify(relationship.metadata)
    );
    return relationship;
  }

  public listContacts(userId: string): PersonalContact[] {
    const rows = this.db.prepare("SELECT * FROM personal_contacts WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC")
      .all(userId) as unknown as ContactRow[];
    return rows.map(toContact);
  }

  public listOrganizations(userId: string): PersonalOrganization[] {
    const rows = this.db.prepare("SELECT * FROM personal_contact_organizations WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as unknown as OrganizationRow[];
    return rows.map(toOrganization);
  }

  public listRelationships(userId: string): PersonalRelationship[] {
    const rows = this.db.prepare("SELECT * FROM personal_contact_relationships WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as unknown as RelationshipRow[];
    return rows.map(toRelationship);
  }

  public listChannelIdentities(userId: string): PersonalChannelIdentity[] {
    const rows = this.db.prepare("SELECT * FROM personal_contact_channel_identities WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as unknown as ChannelIdentityRow[];
    return rows.map(toChannelIdentity);
  }

  public getContact(userId: string, contactId: string): PersonalContact | undefined {
    const row = this.db.prepare("SELECT * FROM personal_contacts WHERE user_id = ? AND contact_id = ? AND status = 'active'")
      .get(userId, contactId) as unknown as ContactRow | undefined;
    return row ? toContact(row) : undefined;
  }

  public close(): void {
    this.db.close();
  }
}

export class ContactResolver {
  public constructor(private readonly store: ContactGraphStore) {}

  public resolve(userId: string, query: string): ContactResolution {
    const normalized = normalize(query);
    const contacts = this.store.listContacts(userId);
    const relationships = this.store.listRelationships(userId);
    const channels = this.store.listChannelIdentities(userId);
    const organizations = this.store.listOrganizations(userId);
    const relationship = relationships.find((item) =>
      normalize(item.relationship_type) === normalized || normalize(item.label ?? "") === normalized
    );
    if (relationship) {
      const contact = this.store.getContact(userId, relationship.contact_id);
      if (contact) {
        return resolved(query, contact, relationship);
      }
    }
    const organizationIds = organizations
      .filter((organization) => matchesOrganization(organization, normalized))
      .map((organization) => organization.organization_id);
    if (organizationIds.length > 0) {
      const organizationContacts = contacts.filter((contact) => contact.organization_id && organizationIds.includes(contact.organization_id));
      if (organizationContacts.length === 1) {
        const contact = organizationContacts[0];
        return resolved(query, contact, relationships.find((item) => item.contact_id === contact.contact_id));
      }
      if (organizationContacts.length > 1) {
        return {
          status: "ambiguous",
          query,
          candidates: organizationContacts,
          reason: `Multiple contacts belong to organization "${query}".`,
          requires_confirmation: true
        };
      }
    }
    const matched = contacts.filter((contact) => matchesContact(contact, normalized, channels));
    if (matched.length === 1) {
      return resolved(query, matched[0], relationships.find((item) => item.contact_id === matched[0].contact_id));
    }
    if (matched.length > 1) {
      return {
        status: "ambiguous",
        query,
        candidates: matched,
        reason: `Multiple contacts match "${query}".`,
        requires_confirmation: true
      };
    }
    return {
      status: "not_found",
      query,
      candidates: [],
      reason: `No contact matches "${query}".`,
      requires_confirmation: true
    };
  }
}

export function buildContactMessageConfirmation(resolution: ContactResolution): ContactMessageConfirmation {
  if (resolution.status === "ambiguous") {
    return {
      status: "clarification_required",
      query: resolution.query,
      reason: resolution.reason,
      candidates: resolution.candidates
    };
  }
  if (resolution.status === "not_found" || !resolution.contact) {
    return {
      status: "clarification_required",
      query: resolution.query,
      reason: resolution.reason,
      candidates: []
    };
  }
  if (resolution.contact.trust_level === "blocked") {
    return {
      status: "blocked",
      query: resolution.query,
      contact_id: resolution.contact.contact_id,
      display_name: resolution.contact.display_name,
      memory_scope: resolution.memory_scope,
      reason: "Contact is blocked.",
      candidates: [resolution.contact]
    };
  }
  const requires = resolution.relationship?.confirmation_policy === "always"
    || (resolution.relationship?.confirmation_policy === "trusted" && resolution.relationship.trust_level !== "trusted")
    || resolution.contact.trust_level === "external";
  return {
    status: requires ? "confirmation_required" : "ready",
    query: resolution.query,
    recipient_email: resolution.contact.email,
    contact_id: resolution.contact.contact_id,
    display_name: resolution.contact.display_name,
    memory_scope: resolution.memory_scope,
    reason: requires ? "Relationship policy requires explicit confirmation." : "Recipient resolved.",
    candidates: [resolution.contact]
  };
}

export function createContactGraphTools(store: ContactGraphStore): Tool[] {
  const resolver = new ContactResolver(store);
  return [
    {
      name: "contact_organization_upsert",
      description: "Create or update a personal contact organization.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          organization_id: { type: "string" },
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          domain: { type: "string" }
        },
        required: ["user_id", "name"]
      },
      async invoke(input) {
        const organization = store.upsertOrganization({
          user_id: readRequiredString(input.user_id, "user_id"),
          organization_id: readOptionalString(input.organization_id),
          name: readRequiredString(input.name, "name"),
          aliases: readStringArray(input.aliases),
          domain: readOptionalString(input.domain)
        });
        return { summary: `Saved organization ${organization.name}.`, payload: toJsonRecord(organization) };
      }
    },
    {
      name: "contact_upsert",
      description: "Create or update a personal contact.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          contact_id: { type: "string" },
          display_name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          email: { type: "string" },
          organization_id: { type: "string" },
          role: { type: "string" },
          trust_level: { type: "string" },
          default_memory_scope: { type: "string" }
        },
        required: ["user_id", "display_name"]
      },
      async invoke(input) {
        const contact = store.upsertContact({
          user_id: readRequiredString(input.user_id, "user_id"),
          contact_id: readOptionalString(input.contact_id),
          display_name: readRequiredString(input.display_name, "display_name"),
          aliases: readStringArray(input.aliases),
          email: readOptionalString(input.email),
          organization_id: readOptionalString(input.organization_id),
          role: readOptionalString(input.role),
          trust_level: readTrustLevel(input.trust_level),
          default_memory_scope: readOptionalString(input.default_memory_scope)
        });
        return { summary: `Saved contact ${contact.display_name}.`, payload: toJsonRecord(contact) };
      }
    },
    {
      name: "contact_relationship_upsert",
      description: "Create or update a relationship from the user to a contact.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          relationship_id: { type: "string" },
          contact_id: { type: "string" },
          relationship_type: { type: "string" },
          label: { type: "string" },
          trust_level: { type: "string" },
          memory_scope: { type: "string" },
          confirmation_policy: { type: "string" }
        },
        required: ["user_id", "contact_id", "relationship_type"]
      },
      async invoke(input) {
        const relationship = store.upsertRelationship({
          user_id: readRequiredString(input.user_id, "user_id"),
          relationship_id: readOptionalString(input.relationship_id),
          contact_id: readRequiredString(input.contact_id, "contact_id"),
          relationship_type: readRequiredString(input.relationship_type, "relationship_type"),
          label: readOptionalString(input.label),
          trust_level: readTrustLevel(input.trust_level),
          memory_scope: readOptionalString(input.memory_scope),
          confirmation_policy: readConfirmationPolicy(input.confirmation_policy)
        });
        return { summary: `Saved relationship ${relationship.relationship_type}.`, payload: toJsonRecord(relationship) };
      }
    },
    {
      name: "contact_resolve",
      description: "Resolve a person, organization alias or relationship label to a contact.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          query: { type: "string" }
        },
        required: ["user_id", "query"]
      },
      async invoke(input) {
        const resolution = resolver.resolve(readRequiredString(input.user_id, "user_id"), readRequiredString(input.query, "query"));
        return { summary: resolution.reason, payload: toJsonRecord(resolution) };
      }
    },
    {
      name: "contact_list",
      description: "List contacts and relationships for a user.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" }
        },
        required: ["user_id"]
      },
      async invoke(input) {
        const userId = readRequiredString(input.user_id, "user_id");
        return {
          summary: `Listed ${store.listContacts(userId).length} contacts.`,
          payload: {
            contacts: store.listContacts(userId).map(toJsonRecord) as JsonValue,
            organizations: store.listOrganizations(userId).map(toJsonRecord) as JsonValue,
            relationships: store.listRelationships(userId).map(toJsonRecord) as JsonValue,
            channel_identities: store.listChannelIdentities(userId).map(toJsonRecord) as JsonValue
          }
        };
      }
    }
  ];
}

export function createContactAwareEmailSendTool(provider: EmailSendProvider, store: ContactGraphStore): Tool {
  const resolver = new ContactResolver(store);
  return {
    name: "email_send",
    description: "Send an email after resolving contact graph recipients and enforcing relationship confirmation.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "array", items: { type: "string" } },
        confirmed_contact_ids: { type: "array", items: { type: "string" } }
      },
      required: ["to", "subject", "body"]
    },
    async invoke(input) {
      const userId = readOptionalString(input.user_id);
      const rawRecipients = readStringArray(input.to);
      const confirmed = new Set(readStringArray(input.confirmed_contact_ids));
      const confirmations = rawRecipients.map((recipient) => resolveRecipientForMessage(recipient, userId, resolver));
      const unresolved = confirmations.find((item) => item.status === "clarification_required" || item.status === "blocked");
      if (unresolved) {
        return { summary: unresolved.reason, payload: { status: unresolved.status, confirmations: confirmations.map(toJsonRecord) as JsonValue } };
      }
      const needsConfirmation = confirmations.find((item) =>
        item.status === "confirmation_required" && (!item.contact_id || !confirmed.has(item.contact_id))
      );
      if (needsConfirmation) {
        return { summary: needsConfirmation.reason, payload: { status: "confirmation_required", confirmations: confirmations.map(toJsonRecord) as JsonValue } };
      }
      const to = confirmations.map((item) => item.recipient_email).filter((item): item is string => Boolean(item));
      const result = await provider.send({
        to,
        subject: readOptionalString(input.subject) ?? "",
        body: readOptionalString(input.body) ?? "",
        cc: readStringArray(input.cc)
      });
      return {
        summary: `Email sent with id ${result.message_id}.`,
        payload: {
          ...result,
          confirmations: confirmations.map(toJsonRecord) as JsonValue,
          memory_scopes: confirmations.map((item) => item.memory_scope).filter((item): item is string => Boolean(item))
        }
      };
    }
  };
}

function resolveRecipientForMessage(
  recipient: string,
  userId: string | undefined,
  resolver: ContactResolver
): ContactMessageConfirmation {
  if (isEmail(recipient)) {
    return {
      status: "ready",
      query: recipient,
      recipient_email: recipient,
      reason: "Recipient is an explicit email address.",
      candidates: []
    };
  }
  if (!userId) {
    return {
      status: "clarification_required",
      query: recipient,
      reason: "user_id is required to resolve contact graph recipients.",
      candidates: []
    };
  }
  return buildContactMessageConfirmation(resolver.resolve(userId, recipient));
}

function resolved(query: string, contact: PersonalContact, relationship: PersonalRelationship | undefined): ContactResolution {
  return {
    status: "resolved",
    query,
    contact,
    candidates: [contact],
    relationship,
    reason: `Resolved "${query}" to ${contact.display_name}.`,
    memory_scope: relationship?.memory_scope ?? contact.default_memory_scope,
    requires_confirmation: relationship?.confirmation_policy === "always" || contact.trust_level === "external"
  };
}

function matchesContact(contact: PersonalContact, normalized: string, channels: PersonalChannelIdentity[]): boolean {
  const values = [
    contact.display_name,
    contact.email,
    contact.role,
    ...contact.aliases,
    ...channels.filter((channel) => channel.contact_id === contact.contact_id).map((channel) => channel.handle)
  ].filter((value): value is string => Boolean(value));
  return values.some((value) => normalize(value) === normalized || normalize(value).includes(normalized));
}

function matchesOrganization(organization: PersonalOrganization, normalized: string): boolean {
  const values = [
    organization.name,
    organization.domain,
    ...organization.aliases
  ].filter((value): value is string => Boolean(value));
  return values.some((value) => normalize(value) === normalized || normalize(value).includes(normalized));
}

function toOrganization(row: OrganizationRow): PersonalOrganization {
  return {
    organization_id: row.organization_id,
    user_id: row.user_id,
    name: row.name,
    aliases: parseStringArray(row.aliases_json),
    domain: row.domain ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: parseMetadata(row.metadata_json)
  };
}

function toContact(row: ContactRow): PersonalContact {
  return {
    contact_id: row.contact_id,
    user_id: row.user_id,
    display_name: row.display_name,
    aliases: parseStringArray(row.aliases_json),
    email: row.email ?? undefined,
    organization_id: row.organization_id ?? undefined,
    role: row.role ?? undefined,
    trust_level: readTrustLevel(row.trust_level),
    default_memory_scope: row.default_memory_scope ?? undefined,
    status: row.status === "deleted" ? "deleted" : "active",
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: parseMetadata(row.metadata_json)
  };
}

function toRelationship(row: RelationshipRow): PersonalRelationship {
  return {
    relationship_id: row.relationship_id,
    user_id: row.user_id,
    contact_id: row.contact_id,
    relationship_type: row.relationship_type,
    label: row.label ?? undefined,
    trust_level: readTrustLevel(row.trust_level),
    memory_scope: row.memory_scope ?? undefined,
    confirmation_policy: readConfirmationPolicy(row.confirmation_policy),
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: parseMetadata(row.metadata_json)
  };
}

function toChannelIdentity(row: ChannelIdentityRow): PersonalChannelIdentity {
  return {
    channel_identity_id: row.channel_identity_id,
    user_id: row.user_id,
    contact_id: row.contact_id,
    platform: row.platform,
    handle: row.handle,
    trust_level: readTrustLevel(row.trust_level),
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: parseMetadata(row.metadata_json)
  };
}

interface OrganizationRow {
  organization_id: string;
  user_id: string;
  name: string;
  aliases_json: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

interface ContactRow {
  contact_id: string;
  user_id: string;
  display_name: string;
  aliases_json: string;
  email: string | null;
  organization_id: string | null;
  role: string | null;
  trust_level: string;
  default_memory_scope: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

interface RelationshipRow {
  relationship_id: string;
  user_id: string;
  contact_id: string;
  relationship_type: string;
  label: string | null;
  trust_level: string;
  memory_scope: string | null;
  confirmation_policy: string;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

interface ChannelIdentityRow {
  channel_identity_id: string;
  user_id: string;
  contact_id: string;
  platform: string;
  handle: string;
  trust_level: string;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function readTrustLevel(value: unknown): ContactTrustLevel {
  return value === "trusted" || value === "external" || value === "blocked" ? value : "known";
}

function readConfirmationPolicy(value: unknown): ContactConfirmationPolicy {
  return value === "never" || value === "always" ? value : "trusted";
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readStringArray(parsed);
  } catch {
    return [];
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
