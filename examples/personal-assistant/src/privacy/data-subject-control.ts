import { randomUUID } from "node:crypto";
import type { PersonalMemoryRecord, PersonalMemoryStore } from "../memory/personal-memory-store.js";
import type { SessionSearchEntry, SessionSearchListQuery, SessionSearchStore } from "../memory/session-search-store.js";

export type DataSubjectRecordType = "memory" | "trace" | "tool" | "artifact";
export type DataSubjectRecordStatus = "active" | "frozen" | "deleted";
export type DataSubjectPrivacyAction = "privacy.exported" | "privacy.deleted" | "privacy.frozen";

export interface DataSubjectRecord {
  record_id: string;
  type: DataSubjectRecordType;
  user_id: string;
  status: DataSubjectRecordStatus;
  payload?: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  frozen_at?: string;
  source?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DataSubjectAuditRecord {
  audit_id: string;
  action: DataSubjectPrivacyAction;
  user_id: string;
  actor_id: string;
  created_at: string;
  types: DataSubjectRecordType[];
  record_ids: string[];
  counts: Partial<Record<DataSubjectRecordType, number>>;
  details?: Record<string, unknown>;
}

export interface DataSubjectExportBundle {
  export_id: string;
  user_id: string;
  created_at: string;
  records: DataSubjectRecord[];
  retention: DataSubjectRetentionReport;
  audit_records: DataSubjectAuditRecord[];
}

export interface DataSubjectRetentionReport {
  user_id: string;
  created_at: string;
  records: Record<DataSubjectRecordType, DataSubjectRetentionBucket>;
  policies: Record<DataSubjectRecordType, string>;
}

export interface DataSubjectRetentionBucket {
  active: number;
  frozen: number;
  deleted: number;
}

export interface DataSubjectOperationInput {
  user_id: string;
  actor_id: string;
  types?: DataSubjectRecordType[];
  record_ids?: string[];
  tenant_id?: string;
  details?: Record<string, unknown>;
}

export interface DataSubjectExportInput {
  user_id: string;
  actor_id?: string;
  types?: DataSubjectRecordType[];
  record_ids?: string[];
  tenant_id?: string;
  include_deleted?: boolean;
  details?: Record<string, unknown>;
}

export interface PersonalDataSubjectServiceOptions {
  memoryStore?: PersonalMemoryStore;
  sessionSearchStore?: SessionSearchStore;
  records?: DataSubjectRecord[];
  retentionPolicies?: Partial<Record<DataSubjectRecordType, string>>;
  now?: () => string;
}

const ALL_TYPES: DataSubjectRecordType[] = ["memory", "trace", "tool", "artifact"];

const DEFAULT_RETENTION_POLICIES: Record<DataSubjectRecordType, string> = {
  memory: "Retained until user deletion, correction or explicit freeze.",
  trace: "Retained for operational replay until user deletion or retention cleanup.",
  tool: "Retained for audit and debugging until user deletion or retention cleanup.",
  artifact: "Retained while referenced by tasks, traces or user workspace unless deleted."
};

export class PersonalDataSubjectService {
  private readonly genericRecords = new Map<string, DataSubjectRecord>();
  private readonly auditRecords: DataSubjectAuditRecord[] = [];
  private readonly now: () => string;
  private readonly retentionPolicies: Record<DataSubjectRecordType, string>;

  public constructor(private readonly options: PersonalDataSubjectServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.retentionPolicies = {
      ...DEFAULT_RETENTION_POLICIES,
      ...options.retentionPolicies
    };
    for (const record of options.records ?? []) {
      this.registerRecord(record);
    }
  }

  public registerRecord(record: DataSubjectRecord): DataSubjectRecord {
    const cloned = clone(record);
    this.genericRecords.set(genericKey(cloned.type, cloned.record_id), cloned);
    return clone(cloned);
  }

  public exportUserData(input: DataSubjectExportInput): DataSubjectExportBundle {
    const types = normalizeTypes(input.types);
    const records = this.collectRecords(input.user_id, {
      types,
      recordIds: input.record_ids,
      tenantId: input.tenant_id,
      includeDeleted: input.include_deleted === true
    });
    const audit = this.recordAudit("privacy.exported", input.user_id, input.actor_id ?? input.user_id, types, records, input.details);
    return {
      export_id: `dse_${randomUUID()}`,
      user_id: input.user_id,
      created_at: audit.created_at,
      records,
      retention: this.listRetention(input.user_id, input.tenant_id),
      audit_records: this.listAuditRecords(input.user_id)
    };
  }

  public freezeUserData(input: DataSubjectOperationInput): DataSubjectRetentionReport {
    const types = normalizeTypes(input.types);
    const affected = this.mutate("frozen", input, types);
    this.recordAudit("privacy.frozen", input.user_id, input.actor_id, types, affected, input.details);
    return this.listRetention(input.user_id, input.tenant_id);
  }

  public deleteUserData(input: DataSubjectOperationInput): DataSubjectRetentionReport {
    const types = normalizeTypes(input.types);
    const affected = this.mutate("deleted", input, types);
    this.recordAudit("privacy.deleted", input.user_id, input.actor_id, types, affected, input.details);
    return this.listRetention(input.user_id, input.tenant_id);
  }

  public listRetention(userId: string, tenantId?: string): DataSubjectRetentionReport {
    const records = this.collectRecords(userId, { types: ALL_TYPES, tenantId, includeDeleted: true });
    const buckets = Object.fromEntries(ALL_TYPES.map((type) => [type, { active: 0, frozen: 0, deleted: 0 }])) as Record<DataSubjectRecordType, DataSubjectRetentionBucket>;
    for (const record of records) {
      buckets[record.type][record.status] += 1;
    }
    return {
      user_id: userId,
      created_at: this.now(),
      records: buckets,
      policies: { ...this.retentionPolicies }
    };
  }

  public listAuditRecords(userId?: string): DataSubjectAuditRecord[] {
    return this.auditRecords
      .filter((record) => !userId || record.user_id === userId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((record) => clone(record));
  }

  private mutate(
    status: "frozen" | "deleted",
    input: DataSubjectOperationInput,
    types: DataSubjectRecordType[]
  ): DataSubjectRecord[] {
    const affected: DataSubjectRecord[] = [];
    const timestamp = this.now();

    if (types.includes("memory")) {
      affected.push(...this.mutateMemory(status, input, timestamp));
    }
    if (types.includes("trace")) {
      affected.push(...this.mutateSessionSearch(status, "trace", input, timestamp));
    }
    if (types.includes("tool")) {
      affected.push(...this.mutateSessionSearch(status, "tool", input, timestamp));
    }
    if (types.includes("artifact")) {
      affected.push(...this.mutateGenericRecords(status, "artifact", input, timestamp));
    }
    if (types.includes("trace")) {
      affected.push(...this.mutateGenericRecords(status, "trace", input, timestamp));
    }
    if (types.includes("tool")) {
      affected.push(...this.mutateGenericRecords(status, "tool", input, timestamp));
    }

    return dedupeRecords(affected);
  }

  private mutateMemory(
    status: "frozen" | "deleted",
    input: DataSubjectOperationInput,
    timestamp: string
  ): DataSubjectRecord[] {
    if (status === "frozen" && this.options.memoryStore?.freeze) {
      const targets = input.record_ids?.length ? input.record_ids : ["all"];
      return targets.flatMap((target) => this.options.memoryStore?.freeze?.(input.user_id, target, timestamp) ?? [])
        .map(memoryToDataSubjectRecord);
    }
    if (status === "deleted") {
      const targets = input.record_ids?.length ? input.record_ids : ["all"];
      return targets.flatMap((target) => this.options.memoryStore?.forget(input.user_id, target, timestamp) ?? [])
        .map(memoryToDataSubjectRecord);
    }
    return [];
  }

  private mutateSessionSearch(
    status: "frozen" | "deleted",
    type: "trace" | "tool",
    input: DataSubjectOperationInput,
    timestamp: string
  ): DataSubjectRecord[] {
    const store = this.options.sessionSearchStore;
    const query: SessionSearchListQuery = {
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      trace_ids: type === "trace" ? input.record_ids : undefined,
      entry_ids: type === "tool" ? input.record_ids : undefined,
      roles: type === "tool" ? ["tool"] : ["user", "assistant", "system"],
      includeInactive: true
    };
    if (status === "frozen" && store?.freezeEntries) {
      return store.freezeEntries(query, timestamp).map((entry) => sessionEntryToRecord(type, entry));
    }
    if (status === "deleted" && store?.deleteEntries) {
      return store.deleteEntries(query, timestamp).map((entry) => sessionEntryToRecord(type, entry));
    }
    return [];
  }

  private mutateGenericRecords(
    status: "frozen" | "deleted",
    type: DataSubjectRecordType,
    input: DataSubjectOperationInput,
    timestamp: string
  ): DataSubjectRecord[] {
    const affected: DataSubjectRecord[] = [];
    for (const record of this.genericRecords.values()) {
      if (record.user_id !== input.user_id || record.type !== type) {
        continue;
      }
      if (input.record_ids?.length && !input.record_ids.includes(record.record_id)) {
        continue;
      }
      if (record.status === "deleted") {
        continue;
      }
      const next: DataSubjectRecord = {
        ...record,
        status,
        payload: status === "deleted" ? undefined : record.payload,
        updated_at: timestamp,
        deleted_at: status === "deleted" ? timestamp : record.deleted_at,
        frozen_at: status === "frozen" ? timestamp : record.frozen_at
      };
      this.genericRecords.set(genericKey(next.type, next.record_id), clone(next));
      affected.push(clone(next));
    }
    return affected;
  }

  private collectRecords(
    userId: string,
    options: {
      types: DataSubjectRecordType[];
      tenantId?: string;
      recordIds?: string[];
      includeDeleted?: boolean;
    }
  ): DataSubjectRecord[] {
    const records: DataSubjectRecord[] = [];
    if (options.types.includes("memory")) {
      records.push(...this.collectMemoryRecords(userId, options));
    }
    if (options.types.includes("trace") || options.types.includes("tool")) {
      records.push(...this.collectSessionSearchRecords(userId, options));
    }
    records.push(...this.collectGenericRecords(userId, options));
    return dedupeRecords(records)
      .filter((record) => options.includeDeleted || record.status !== "deleted")
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.type.localeCompare(right.type));
  }

  private collectMemoryRecords(
    userId: string,
    options: { recordIds?: string[]; includeDeleted?: boolean }
  ): DataSubjectRecord[] {
    const records = this.options.memoryStore?.listForUser
      ? this.options.memoryStore.listForUser(userId, { includeInactive: true, limit: 5000 })
      : this.options.memoryStore?.listActive(userId, 5000) ?? [];
    return records
      .map(memoryToDataSubjectRecord)
      .filter((record) => !options.recordIds?.length || options.recordIds.includes(record.record_id))
      .filter((record) => options.includeDeleted || record.status !== "deleted");
  }

  private collectSessionSearchRecords(
    userId: string,
    options: { types: DataSubjectRecordType[]; tenantId?: string; recordIds?: string[]; includeDeleted?: boolean }
  ): DataSubjectRecord[] {
    const entries = this.options.sessionSearchStore?.listEntries?.({
      tenant_id: options.tenantId,
      user_id: userId,
      includeInactive: true,
      limit: 5000
    }) ?? [];
    const records: DataSubjectRecord[] = [];
    if (options.types.includes("trace")) {
      records.push(...groupTraceEntries(entries.filter((entry) => !isToolEntry(entry))).map((entry) => sessionEntryToRecord("trace", entry)));
    }
    if (options.types.includes("tool")) {
      records.push(...entries.filter(isToolEntry).map((entry) => sessionEntryToRecord("tool", entry)));
    }
    return records
      .filter((record) => !options.recordIds?.length || options.recordIds.includes(record.record_id))
      .filter((record) => options.includeDeleted || record.status !== "deleted");
  }

  private collectGenericRecords(
    userId: string,
    options: { types: DataSubjectRecordType[]; recordIds?: string[]; includeDeleted?: boolean }
  ): DataSubjectRecord[] {
    return [...this.genericRecords.values()]
      .filter((record) => record.user_id === userId)
      .filter((record) => options.types.includes(record.type))
      .filter((record) => !options.recordIds?.length || options.recordIds.includes(record.record_id))
      .filter((record) => options.includeDeleted || record.status !== "deleted")
      .map((record) => clone(record));
  }

  private recordAudit(
    action: DataSubjectPrivacyAction,
    userId: string,
    actorId: string,
    types: DataSubjectRecordType[],
    records: DataSubjectRecord[],
    details?: Record<string, unknown>
  ): DataSubjectAuditRecord {
    const counts = countByType(records);
    const audit: DataSubjectAuditRecord = {
      audit_id: `dsa_${randomUUID()}`,
      action,
      user_id: userId,
      actor_id: actorId,
      created_at: this.now(),
      types,
      record_ids: records.map((record) => record.record_id),
      counts,
      details: details ? clone(details) : undefined
    };
    this.auditRecords.push(audit);
    return clone(audit);
  }
}

function normalizeTypes(types: DataSubjectRecordType[] | undefined): DataSubjectRecordType[] {
  if (!types?.length) {
    return [...ALL_TYPES];
  }
  return [...new Set(types.filter((type): type is DataSubjectRecordType => ALL_TYPES.includes(type)))];
}

function memoryToDataSubjectRecord(memory: PersonalMemoryRecord): DataSubjectRecord {
  return {
    record_id: memory.memory_id,
    type: "memory",
    user_id: memory.user_id,
    status: memory.status === "active" ? "active" : memory.status === "frozen" ? "frozen" : "deleted",
    payload: memory.status === "tombstoned" ? undefined : {
      content: memory.content,
      correction_of: memory.correction_of,
      source: memory.source
    },
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    deleted_at: memory.tombstoned_at,
    frozen_at: memory.frozen_at,
    source: memory.source ? { ...memory.source } : undefined,
    metadata: {
      correction_of: memory.correction_of
    }
  };
}

function sessionEntryToRecord(type: "trace" | "tool", entry: SessionSearchEntry): DataSubjectRecord {
  const recordId = type === "trace" ? entry.trace_id ?? entry.entry_id : entry.entry_id;
  return {
    record_id: recordId,
    type,
    user_id: entry.user_id ?? "unknown",
    status: entry.privacy_status ?? "active",
    payload: entry.privacy_status === "deleted" ? undefined : {
      entry_id: entry.entry_id,
      session_id: entry.session_id,
      cycle_id: entry.cycle_id,
      trace_id: entry.trace_id,
      role: entry.role,
      content: entry.content,
      metadata: entry.metadata
    },
    created_at: entry.created_at,
    updated_at: entry.privacy_updated_at ?? entry.created_at,
    deleted_at: entry.privacy_status === "deleted" ? entry.privacy_updated_at : undefined,
    frozen_at: entry.privacy_status === "frozen" ? entry.privacy_updated_at : undefined,
    source: {
      session_id: entry.session_id,
      cycle_id: entry.cycle_id,
      trace_id: entry.trace_id,
      source_platform: entry.source_platform,
      source_chat_id: entry.source_chat_id,
      source_message_id: entry.source_message_id
    },
    metadata: entry.metadata
  };
}

function groupTraceEntries(entries: SessionSearchEntry[]): SessionSearchEntry[] {
  const byTrace = new Map<string, SessionSearchEntry>();
  for (const entry of entries) {
    const key = entry.trace_id ?? entry.entry_id;
    const current = byTrace.get(key);
    if (!current || entry.created_at > current.created_at) {
      byTrace.set(key, entry);
    }
  }
  return [...byTrace.values()];
}

function isToolEntry(entry: SessionSearchEntry): boolean {
  return entry.role === "tool" || typeof entry.metadata.tool_name === "string" || typeof entry.metadata.tool_action_id === "string";
}

function countByType(records: DataSubjectRecord[]): Partial<Record<DataSubjectRecordType, number>> {
  const counts: Partial<Record<DataSubjectRecordType, number>> = {};
  for (const record of records) {
    counts[record.type] = (counts[record.type] ?? 0) + 1;
  }
  return counts;
}

function dedupeRecords(records: DataSubjectRecord[]): DataSubjectRecord[] {
  const byKey = new Map<string, DataSubjectRecord>();
  for (const record of records) {
    byKey.set(genericKey(record.type, record.record_id), record);
  }
  return [...byKey.values()].map((record) => clone(record));
}

function genericKey(type: DataSubjectRecordType, recordId: string): string {
  return `${type}:${recordId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
