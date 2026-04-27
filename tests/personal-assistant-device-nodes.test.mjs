import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DeviceNodeGateway,
  HeadlessDeviceNodeSimulator
} from "@neurocore/device-core";
import {
  createPersonalAssistantAgent,
  startPersonalAssistantApp
} from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import {
  createDeviceNodeTools,
  pairHeadlessDeviceNodeSimulator
} from "../examples/personal-assistant/dist/devices/device-node-tools.js";

test("device node gateway pairs a simulator declares capabilities gates permissions and audits commands", async () => {
  const gateway = new DeviceNodeGateway();
  const simulator = new HeadlessDeviceNodeSimulator({ nodeId: "node-direct" });
  const code = gateway.createPairingCode({
    canonical_user_id: "user-device",
    code: "PAIRNODE1"
  });
  const manifest = gateway.pairNode({
    code: code.code,
    manifest: simulator.manifest,
    executor: simulator
  });

  assert.equal(manifest.node_id, "node-direct");
  assert.deepEqual(manifest.capabilities.map((capability) => capability.name).sort(), ["camera", "canvas", "location", "screen"]);
  assert.equal(manifest.permissions.find((permission) => permission.capability === "screen")?.status, "prompt");

  const blocked = await gateway.executeCommand({
    node_id: "node-direct",
    capability: "screen",
    action: "capture",
    requester_id: "user-device"
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.error ?? "", /Permission screen is not granted/);

  gateway.setPermission({
    node_id: "node-direct",
    capability: "screen",
    status: "granted",
    actor_id: "user-device"
  });
  gateway.setPermission({
    node_id: "node-direct",
    capability: "camera",
    status: "granted",
    actor_id: "user-device"
  });

  const screen = await gateway.executeCommand({
    node_id: "node-direct",
    capability: "screen",
    action: "capture",
    requester_id: "user-device"
  });
  const camera = await gateway.executeCommand({
    node_id: "node-direct",
    capability: "camera",
    action: "capture",
    requester_id: "user-device"
  });

  assert.equal(screen.status, "completed");
  assert.equal(screen.artifact?.artifact_type, "screen_capture");
  assert.equal(camera.status, "completed");
  assert.equal(camera.artifact?.artifact_type, "camera_frame");

  const auditTypes = gateway.listAuditEvents().map((event) => event.event_type);
  assert.ok(auditTypes.includes("pair_code_created"));
  assert.ok(auditTypes.includes("node_paired"));
  assert.ok(auditTypes.includes("manifest_registered"));
  assert.ok(auditTypes.includes("permission_granted"));
  assert.ok(auditTypes.includes("command_blocked"));
  assert.ok(auditTypes.includes("command_executed"));
});

test("device node tools expose pairing manifest permission command and audit flow", async () => {
  const gateway = new DeviceNodeGateway();
  const tools = new Map(createDeviceNodeTools(gateway).map((tool) => [tool.name, tool]));
  const ctx = { tenant_id: "tenant-device", session_id: "session-device", cycle_id: "cycle-device" };

  await tools.get("device_node_pairing_code_create").invoke({
    canonical_user_id: "user-device",
    code: "PAIRNODE2"
  }, ctx);
  const paired = await tools.get("device_node_simulator_pair").invoke({
    code: "PAIRNODE2",
    node_id: "node-tool",
    display_name: "Tool Node"
  }, ctx);
  assert.equal(paired.payload.manifest.node_id, "node-tool");

  const listed = await tools.get("device_node_list").invoke({}, ctx);
  assert.equal(listed.payload.nodes.length, 1);
  assert.equal(listed.payload.nodes[0].capabilities.length, 4);

  const blocked = await tools.get("device_node_execute").invoke({
    node_id: "node-tool",
    capability: "screen",
    action: "capture"
  }, ctx);
  assert.equal(blocked.payload.result.status, "blocked");

  await tools.get("device_node_permission_set").invoke({
    node_id: "node-tool",
    capability: "screen",
    status: "granted",
    actor_id: "user-device"
  }, ctx);
  const executed = await tools.get("device_node_execute").invoke({
    node_id: "node-tool",
    capability: "screen",
    action: "capture"
  }, ctx);
  assert.equal(executed.payload.result.status, "completed");
  assert.equal(executed.payload.result.artifact.artifact_type, "screen_capture");

  const audit = await tools.get("device_node_audit").invoke({ limit: 10 }, ctx);
  assert.ok(audit.payload.events.some((event) => event.event_type === "command_executed"));
});

test("personal assistant runtime executes a permitted device node simulator command", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-device-node-"));
  const gateway = new DeviceNodeGateway();
  pairHeadlessDeviceNodeSimulator(gateway, {
    nodeId: "node-runtime",
    actorId: "owner",
    grant: ["screen"]
  });

  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "tenant-device",
      reasoner: createDeviceNodeReasoner(),
      agent: {
        auto_approve: true,
        max_cycles: 3
      }
    }, {
      deviceNodeGateway: gateway
    });
    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-device",
      initial_input: {
        content: "capture my screen"
      }
    });
    const result = await session.run();
    const observation = findToolObservation(session, "device_node_execute");

    assert.equal(result.finalState, "completed");
    assert.match(result.outputText ?? "", /screen\.capture/);
    assert.equal(observation.structured_payload.result.status, "completed");
    assert.equal(observation.structured_payload.result.artifact.artifact_type, "screen_capture");
    assert.ok(gateway.listAuditEvents().some((event) => event.event_type === "command_executed"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant app config can bootstrap a paired simulator node", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-device-app-"));
  const app = await startPersonalAssistantApp({
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-device",
    reasoner: createDeviceNodeReasoner(),
    web_chat: {
      enabled: false
    },
    devices: {
      enabled: true,
      simulator: true,
      auto_grant_simulator: true,
      simulator_node_id: "node-app"
    }
  });

  try {
    assert.equal(app.deviceNodeGateway.listNodes().length, 1);
    assert.equal(app.deviceNodeGateway.getManifest("node-app").permissions.find((permission) => permission.capability === "screen")?.status, "granted");
    assert.ok(app.builder.getProfile().tool_refs.includes("device_node_execute"));
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createDeviceNodeReasoner() {
  return {
    name: "device-node-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "device-node-reasoner",
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "Execute permitted device command." }
      }];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
      if (input.startsWith("Tool observation:")) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Return device result",
          description: input.replace(/^Tool observation:\s*/, "").trim(),
          side_effect_level: "none"
        }];
      }
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "Capture screen",
        tool_name: "device_node_execute",
        tool_args: {
          node_id: "node-runtime",
          capability: "screen",
          action: "capture",
          parameters: {
            active_app: "simulator"
          }
        },
        side_effect_level: "high"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function findToolObservation(session, toolName) {
  const record = session.getTraceRecords().find((candidate) =>
    candidate.selected_action?.tool_name === toolName &&
    candidate.observation?.status === "success"
  );
  assert.ok(record?.observation, `expected trace observation for ${toolName}`);
  return record.observation;
}
