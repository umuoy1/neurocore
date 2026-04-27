import type { JsonValue, Tool } from "@neurocore/protocol";
import {
  DeviceNodeGateway,
  HeadlessDeviceNodeSimulator,
  type DeviceNodeCapabilityName,
  type DeviceNodeCommandResult,
  type DeviceNodeManifest,
  type DeviceNodePermissionStatus
} from "@neurocore/device-core";

export function createDeviceNodeTools(gateway: DeviceNodeGateway): Tool[] {
  return [
    createPairingCodeTool(gateway),
    createSimulatorPairTool(gateway),
    createListTool(gateway),
    createPermissionTool(gateway),
    createExecuteTool(gateway),
    createAuditTool(gateway)
  ];
}

export function pairHeadlessDeviceNodeSimulator(
  gateway: DeviceNodeGateway,
  input: { nodeId?: string; displayName?: string; actorId?: string; grant?: DeviceNodeCapabilityName[] } = {}
): DeviceNodeManifest {
  const simulator = new HeadlessDeviceNodeSimulator({
    nodeId: input.nodeId,
    displayName: input.displayName
  });
  const code = gateway.createPairingCode({ canonical_user_id: input.actorId }).code;
  const manifest = gateway.pairNode({
    code,
    manifest: simulator.manifest,
    executor: simulator
  });
  for (const capability of input.grant ?? []) {
    gateway.setPermission({
      node_id: manifest.node_id,
      capability,
      status: "granted",
      actor_id: input.actorId,
      reason: "simulator bootstrap"
    });
  }
  return gateway.getManifest(manifest.node_id) ?? manifest;
}

function createPairingCodeTool(gateway: DeviceNodeGateway): Tool {
  return {
    name: "device_node_pairing_code_create",
    description: "Create a pairing code for a desktop, mobile or headless personal device node.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        canonical_user_id: { type: "string" },
        code: { type: "string" }
      }
    },
    async invoke(input) {
      const code = gateway.createPairingCode({
        canonical_user_id: readOptionalString(input.canonical_user_id),
        code: readOptionalString(input.code)
      });
      return {
        summary: `Created device node pairing code ${code.code}.`,
        payload: toPayload({ pairing_code: code })
      };
    }
  };
}

function createSimulatorPairTool(gateway: DeviceNodeGateway): Tool {
  return {
    name: "device_node_simulator_pair",
    description: "Pair a local headless device node simulator through the node pairing protocol.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        canonical_user_id: { type: "string" },
        node_id: { type: "string" },
        display_name: { type: "string" }
      }
    },
    async invoke(input) {
      const simulator = new HeadlessDeviceNodeSimulator({
        nodeId: readOptionalString(input.node_id),
        displayName: readOptionalString(input.display_name)
      });
      const code = readOptionalString(input.code) ?? gateway.createPairingCode({
        canonical_user_id: readOptionalString(input.canonical_user_id)
      }).code;
      const manifest = gateway.pairNode({
        code,
        manifest: simulator.manifest,
        executor: simulator
      });
      return {
        summary: `Paired device node ${manifest.node_id} with ${manifest.capabilities.length} capabilities.`,
        payload: toPayload({ manifest })
      };
    }
  };
}

function createListTool(gateway: DeviceNodeGateway): Tool {
  return {
    name: "device_node_list",
    description: "List paired personal device nodes and their declared capabilities.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {}
    },
    async invoke() {
      const nodes = gateway.listNodes();
      return {
        summary: `Listed ${nodes.length} device node${nodes.length === 1 ? "" : "s"}.`,
        payload: toPayload({ nodes })
      };
    }
  };
}

function createPermissionTool(gateway: DeviceNodeGateway): Tool {
  return {
    name: "device_node_permission_set",
    description: "Grant, deny or reset a device node capability permission.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        node_id: { type: "string" },
        capability: { type: "string" },
        status: { type: "string" },
        actor_id: { type: "string" },
        reason: { type: "string" }
      },
      required: ["node_id", "capability", "status"]
    },
    async invoke(input) {
      const nodeId = readRequiredString(input.node_id, "node_id");
      const capability = readCapability(input.capability);
      const status = readPermissionStatus(input.status);
      const manifest = gateway.setPermission({
        node_id: nodeId,
        capability,
        status,
        actor_id: readOptionalString(input.actor_id),
        reason: readOptionalString(input.reason)
      });
      return {
        summary: `Set ${capability} permission on ${nodeId} to ${status}.`,
        payload: toPayload({ manifest })
      };
    }
  };
}

function createExecuteTool(gateway: DeviceNodeGateway): Tool {
  return {
    name: "device_node_execute",
    description: "Execute a permitted camera, screen, location or canvas command on a paired device node.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        node_id: { type: "string" },
        capability: { type: "string" },
        action: { type: "string" },
        parameters: { type: "object" },
        requester_id: { type: "string" },
        timeout_ms: { type: "number" }
      },
      required: ["node_id", "capability", "action"]
    },
    async invoke(input, ctx) {
      const result = await gateway.executeCommand({
        node_id: readRequiredString(input.node_id, "node_id"),
        capability: readCapability(input.capability),
        action: readRequiredString(input.action, "action"),
        parameters: readRecord(input.parameters),
        requester_id: readOptionalString(input.requester_id) ?? ctx.session_id,
        timeout_ms: readOptionalNumber(input.timeout_ms)
      });
      return {
        summary: formatCommandSummary(result),
        payload: toPayload({ result })
      };
    }
  };
}

function createAuditTool(gateway: DeviceNodeGateway): Tool {
  return {
    name: "device_node_audit",
    description: "List recent device node pairing, permission and command audit events.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" }
      }
    },
    async invoke(input) {
      const limit = readOptionalNumber(input.limit) ?? 20;
      const events = gateway.listAuditEvents().slice(-limit);
      return {
        summary: `Listed ${events.length} device node audit event${events.length === 1 ? "" : "s"}.`,
        payload: toPayload({ events })
      };
    }
  };
}

function formatCommandSummary(result: DeviceNodeCommandResult): string {
  if (result.status === "completed") {
    return `Device node ${result.node_id} completed ${result.capability}.${result.action}.`;
  }
  if (result.status === "blocked") {
    return `Device node ${result.node_id} blocked ${result.capability}.${result.action}: ${result.error ?? "permission denied"}.`;
  }
  return `Device node ${result.node_id} failed ${result.capability}.${result.action}: ${result.error ?? "unknown error"}.`;
}

function readCapability(value: unknown): DeviceNodeCapabilityName {
  if (value === "camera" || value === "screen" || value === "location" || value === "canvas" || value === "voice") {
    return value;
  }
  throw new Error(`Unsupported device capability: ${String(value)}`);
}

function readPermissionStatus(value: unknown): DeviceNodePermissionStatus {
  if (value === "prompt" || value === "granted" || value === "denied") {
    return value;
  }
  throw new Error(`Unsupported device permission status: ${String(value)}`);
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

function toPayload(value: Record<string, unknown>): Record<string, JsonValue | undefined> {
  return value as Record<string, JsonValue | undefined>;
}
