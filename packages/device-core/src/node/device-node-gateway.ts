import { MockCameraSensor } from "../sensor/mock-camera-sensor.js";

export type DeviceNodeKind = "desktop" | "mobile" | "headless";
export type DeviceNodeCapabilityName = "camera" | "screen" | "location" | "canvas" | "voice";
export type DeviceNodePermissionStatus = "prompt" | "granted" | "denied";
export type DeviceNodeCommandStatus = "completed" | "failed" | "blocked";

export interface DeviceNodeCapability {
  name: DeviceNodeCapabilityName;
  actions: string[];
  modality: string;
  sensitive: boolean;
  metadata?: Record<string, unknown>;
}

export interface DeviceNodePermission {
  capability: DeviceNodeCapabilityName;
  status: DeviceNodePermissionStatus;
  granted_by?: string;
  granted_at?: string;
  reason?: string;
}

export interface DeviceNodeManifest {
  node_id: string;
  node_kind: DeviceNodeKind;
  display_name: string;
  app_version?: string;
  capabilities: DeviceNodeCapability[];
  permissions: DeviceNodePermission[];
  paired_at?: string;
  last_seen_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DeviceNodePairingCode {
  code: string;
  canonical_user_id?: string;
  created_at: string;
  expires_at: string;
  consumed_at?: string;
  node_id?: string;
}

export type DeviceNodeAuditEventType =
  | "pair_code_created"
  | "node_paired"
  | "manifest_registered"
  | "permission_granted"
  | "permission_denied"
  | "command_executed"
  | "command_blocked"
  | "command_failed";

export interface DeviceNodeAuditEvent {
  audit_id: string;
  event_type: DeviceNodeAuditEventType;
  node_id?: string;
  capability?: DeviceNodeCapabilityName;
  action?: string;
  actor_id?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface DeviceNodeCommand {
  command_id?: string;
  node_id: string;
  capability: DeviceNodeCapabilityName;
  action: string;
  parameters?: Record<string, unknown>;
  requester_id?: string;
  timeout_ms?: number;
}

export interface DeviceNodeArtifact {
  artifact_id: string;
  artifact_type: "camera_frame" | "screen_capture" | "canvas_snapshot";
  mime_type: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface DeviceNodeCommandResult {
  command_id: string;
  node_id: string;
  capability: DeviceNodeCapabilityName;
  action: string;
  status: DeviceNodeCommandStatus;
  artifact?: DeviceNodeArtifact;
  payload?: Record<string, unknown>;
  error?: string;
  audit_id?: string;
}

export interface DeviceNodeExecutor {
  execute(command: RequiredDeviceNodeCommand): Promise<Omit<DeviceNodeCommandResult, "audit_id">>;
}

export interface RequiredDeviceNodeCommand extends DeviceNodeCommand {
  command_id: string;
  parameters: Record<string, unknown>;
}

export interface DeviceNodeGatewayOptions {
  codeTtlMs?: number;
  now?: () => string;
  generateId?: (prefix: string) => string;
}

interface RegisteredNode {
  manifest: DeviceNodeManifest;
  executor?: DeviceNodeExecutor;
}

export class DeviceNodeGateway {
  private readonly pairingCodes = new Map<string, DeviceNodePairingCode>();
  private readonly nodes = new Map<string, RegisteredNode>();
  private readonly auditEvents: DeviceNodeAuditEvent[] = [];
  private sequence = 0;

  public constructor(private readonly options: DeviceNodeGatewayOptions = {}) {}

  public createPairingCode(input: { canonical_user_id?: string; code?: string } = {}): DeviceNodePairingCode {
    const timestamp = this.now();
    const code = input.code ?? this.generatePairingCode();
    const record: DeviceNodePairingCode = {
      code,
      canonical_user_id: input.canonical_user_id,
      created_at: timestamp,
      expires_at: new Date(Date.parse(timestamp) + (this.options.codeTtlMs ?? 10 * 60 * 1000)).toISOString()
    };
    this.pairingCodes.set(code, record);
    this.recordAudit({
      event_type: "pair_code_created",
      actor_id: input.canonical_user_id,
      metadata: { code }
    });
    return { ...record };
  }

  public pairNode(input: { code: string; manifest: DeviceNodeManifest; executor?: DeviceNodeExecutor }): DeviceNodeManifest {
    const code = this.pairingCodes.get(input.code);
    if (!code || code.consumed_at || Date.parse(code.expires_at) < Date.parse(this.now())) {
      throw new Error("Device node pairing code is invalid or expired.");
    }
    const timestamp = this.now();
    const manifest = normalizeManifest(input.manifest, timestamp);
    this.nodes.set(manifest.node_id, {
      manifest,
      executor: input.executor
    });
    code.consumed_at = timestamp;
    code.node_id = manifest.node_id;
    this.recordAudit({
      event_type: "node_paired",
      node_id: manifest.node_id,
      actor_id: code.canonical_user_id,
      metadata: {
        node_kind: manifest.node_kind,
        capability_count: manifest.capabilities.length
      }
    });
    this.recordAudit({
      event_type: "manifest_registered",
      node_id: manifest.node_id,
      actor_id: code.canonical_user_id,
      metadata: {
        capabilities: manifest.capabilities.map((capability) => capability.name)
      }
    });
    return cloneManifest(manifest);
  }

  public listNodes(): DeviceNodeManifest[] {
    return [...this.nodes.values()].map((node) => cloneManifest(node.manifest));
  }

  public getManifest(nodeId: string): DeviceNodeManifest | undefined {
    const node = this.nodes.get(nodeId);
    return node ? cloneManifest(node.manifest) : undefined;
  }

  public setPermission(input: {
    node_id: string;
    capability: DeviceNodeCapabilityName;
    status: DeviceNodePermissionStatus;
    actor_id?: string;
    reason?: string;
  }): DeviceNodeManifest {
    const node = this.requireNode(input.node_id);
    if (!node.manifest.capabilities.some((capability) => capability.name === input.capability)) {
      throw new Error(`Node ${input.node_id} does not declare capability ${input.capability}.`);
    }
    const timestamp = this.now();
    const permissions = node.manifest.permissions.filter((permission) => permission.capability !== input.capability);
    permissions.push({
      capability: input.capability,
      status: input.status,
      granted_by: input.status === "granted" ? input.actor_id : undefined,
      granted_at: input.status === "granted" ? timestamp : undefined,
      reason: input.reason
    });
    node.manifest = {
      ...node.manifest,
      permissions: sortPermissions(permissions),
      last_seen_at: timestamp
    };
    this.recordAudit({
      event_type: input.status === "granted" ? "permission_granted" : "permission_denied",
      node_id: input.node_id,
      capability: input.capability,
      actor_id: input.actor_id,
      metadata: { reason: input.reason, status: input.status }
    });
    return cloneManifest(node.manifest);
  }

  public async executeCommand(input: DeviceNodeCommand): Promise<DeviceNodeCommandResult> {
    const command: RequiredDeviceNodeCommand = {
      ...input,
      command_id: input.command_id ?? this.generateId("dvc_cmd"),
      parameters: input.parameters ?? {}
    };
    const node = this.nodes.get(command.node_id);
    if (!node) {
      const audit = this.recordAudit({
        event_type: "command_failed",
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        actor_id: command.requester_id,
        metadata: { error: "node_not_found" }
      });
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "failed",
        error: "Device node was not found.",
        audit_id: audit.audit_id
      };
    }
    const capability = node.manifest.capabilities.find((item) => item.name === command.capability);
    if (!capability || !capability.actions.includes(command.action)) {
      const audit = this.recordAudit({
        event_type: "command_failed",
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        actor_id: command.requester_id,
        metadata: { error: "unsupported_capability_action" }
      });
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "failed",
        error: "Device node does not support this capability action.",
        audit_id: audit.audit_id
      };
    }
    const permission = node.manifest.permissions.find((item) => item.capability === command.capability);
    if (permission?.status !== "granted") {
      const audit = this.recordAudit({
        event_type: "command_blocked",
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        actor_id: command.requester_id,
        metadata: {
          permission_status: permission?.status ?? "prompt"
        }
      });
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "blocked",
        error: `Permission ${command.capability} is not granted.`,
        audit_id: audit.audit_id
      };
    }
    if (!node.executor) {
      const audit = this.recordAudit({
        event_type: "command_failed",
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        actor_id: command.requester_id,
        metadata: { error: "executor_not_available" }
      });
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "failed",
        error: "Device node executor is not available.",
        audit_id: audit.audit_id
      };
    }
    try {
      const result = await node.executor.execute(command);
      node.manifest = {
        ...node.manifest,
        last_seen_at: this.now()
      };
      const audit = this.recordAudit({
        event_type: result.status === "completed" ? "command_executed" : "command_failed",
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        actor_id: command.requester_id,
        metadata: {
          status: result.status,
          artifact_type: result.artifact?.artifact_type
        }
      });
      return { ...result, audit_id: audit.audit_id };
    } catch (error) {
      const audit = this.recordAudit({
        event_type: "command_failed",
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        actor_id: command.requester_id,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      });
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        audit_id: audit.audit_id
      };
    }
  }

  public listAuditEvents(): DeviceNodeAuditEvent[] {
    return this.auditEvents.map((event) => ({ ...event, metadata: cloneRecord(event.metadata) }));
  }

  private requireNode(nodeId: string): RegisteredNode {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Device node ${nodeId} is not paired.`);
    }
    return node;
  }

  private recordAudit(input: Omit<DeviceNodeAuditEvent, "audit_id" | "created_at">): DeviceNodeAuditEvent {
    const event: DeviceNodeAuditEvent = {
      ...input,
      audit_id: this.generateId("dvc_audit"),
      created_at: this.now()
    };
    this.auditEvents.push(event);
    return event;
  }

  private generatePairingCode(): string {
    return this.generateId("NODE").replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase();
  }

  private generateId(prefix: string): string {
    if (this.options.generateId) {
      return this.options.generateId(prefix);
    }
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(6, "0")}`;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}

export interface HeadlessDeviceNodeSimulatorOptions {
  nodeId?: string;
  displayName?: string;
}

export class HeadlessDeviceNodeSimulator implements DeviceNodeExecutor {
  private readonly camera: MockCameraSensor;
  public readonly manifest: DeviceNodeManifest;

  public constructor(options: HeadlessDeviceNodeSimulatorOptions = {}) {
    const nodeId = options.nodeId ?? "headless-node-01";
    this.camera = new MockCameraSensor(`${nodeId}-camera`);
    this.manifest = normalizeManifest({
      node_id: nodeId,
      node_kind: "headless",
      display_name: options.displayName ?? "Headless Node Simulator",
      app_version: "simulator-1.0.0",
      capabilities: [
        { name: "camera", actions: ["capture"], modality: "visual", sensitive: true, metadata: { mock: true } },
        { name: "screen", actions: ["capture"], modality: "visual", sensitive: true, metadata: { mock: true } },
        { name: "location", actions: ["current"], modality: "geo", sensitive: true, metadata: { mock: true } },
        { name: "canvas", actions: ["snapshot", "render"], modality: "artifact", sensitive: false, metadata: { mock: true } }
      ],
      permissions: [],
      metadata: { simulator: true }
    }, new Date().toISOString());
  }

  public async execute(command: RequiredDeviceNodeCommand): Promise<Omit<DeviceNodeCommandResult, "audit_id">> {
    if (command.capability === "camera" && command.action === "capture") {
      await this.camera.start();
      const reading = await this.camera.read();
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "completed",
        artifact: {
          artifact_id: `${command.command_id}_camera`,
          artifact_type: "camera_frame",
          mime_type: "image/png",
          url: reading.raw_data_ref ?? `fixture://device/${command.node_id}/camera.png`,
          metadata: reading.structured_data
        },
        payload: {
          sensor_id: reading.sensor_id,
          confidence: reading.confidence
        }
      };
    }
    if (command.capability === "screen" && command.action === "capture") {
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "completed",
        artifact: {
          artifact_id: `${command.command_id}_screen`,
          artifact_type: "screen_capture",
          mime_type: "image/png",
          url: `fixture://device/${command.node_id}/screen.png`,
          metadata: {
            width: 1440,
            height: 900,
            active_app: command.parameters.active_app ?? "simulator"
          }
        }
      };
    }
    if (command.capability === "location" && command.action === "current") {
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "completed",
        payload: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy_m: 5,
          source: "simulator"
        }
      };
    }
    if (command.capability === "canvas" && (command.action === "snapshot" || command.action === "render")) {
      return {
        command_id: command.command_id,
        node_id: command.node_id,
        capability: command.capability,
        action: command.action,
        status: "completed",
        artifact: {
          artifact_id: `${command.command_id}_canvas`,
          artifact_type: "canvas_snapshot",
          mime_type: "text/html",
          url: `fixture://device/${command.node_id}/canvas.html`,
          metadata: {
            title: command.parameters.title ?? "Device Canvas",
            html: command.parameters.html ?? "<main>Device canvas simulator</main>"
          }
        }
      };
    }
    return {
      command_id: command.command_id,
      node_id: command.node_id,
      capability: command.capability,
      action: command.action,
      status: "failed",
      error: "Unsupported simulator command."
    };
  }
}

function normalizeManifest(manifest: DeviceNodeManifest, timestamp: string): DeviceNodeManifest {
  const permissions = new Map<DeviceNodeCapabilityName, DeviceNodePermission>();
  for (const capability of manifest.capabilities) {
    permissions.set(capability.name, {
      capability: capability.name,
      status: "prompt"
    });
  }
  for (const permission of manifest.permissions) {
    permissions.set(permission.capability, { ...permission });
  }
  return {
    ...manifest,
    capabilities: manifest.capabilities.map((capability) => ({
      ...capability,
      actions: [...capability.actions],
      metadata: cloneRecord(capability.metadata)
    })),
    permissions: sortPermissions([...permissions.values()]),
    paired_at: manifest.paired_at ?? timestamp,
    last_seen_at: manifest.last_seen_at ?? timestamp,
    metadata: cloneRecord(manifest.metadata)
  };
}

function sortPermissions(permissions: DeviceNodePermission[]): DeviceNodePermission[] {
  return [...permissions].sort((a, b) => a.capability.localeCompare(b.capability));
}

function cloneManifest(manifest: DeviceNodeManifest): DeviceNodeManifest {
  return {
    ...manifest,
    capabilities: manifest.capabilities.map((capability) => ({
      ...capability,
      actions: [...capability.actions],
      metadata: cloneRecord(capability.metadata)
    })),
    permissions: manifest.permissions.map((permission) => ({ ...permission })),
    metadata: cloneRecord(manifest.metadata)
  };
}

function cloneRecord<T extends Record<string, unknown> | undefined>(record: T): T {
  return record ? { ...record } as T : record;
}
