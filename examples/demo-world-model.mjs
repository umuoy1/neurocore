process.env.NEUROCORE_DEBUG = "0";

import { AgentRuntime } from "@neurocore/runtime-core";
import {
  InMemoryDeviceRegistry,
  DefaultPerceptionPipeline
} from "@neurocore/device-core";
import {
  InMemoryWorldStateGraph,
  RuleBasedSimulator
} from "@neurocore/world-model";

const log = (tag, ...args) => console.log(`[world-model-demo] ${tag}:`, ...args);
const line = () => console.log("─".repeat(72));

console.log();
log("START", "Smart-Room World Model Demo");
log("START", "Demonstrates: sensors → perception pipeline → world state graph");
log("START", "           → confidence decay → forward simulation → agent cycle");
console.log();

const temperatureSensor = {
  descriptor: {
    sensor_id: "temp-sensor-01",
    sensor_type: "temperature",
    modality: "thermal",
    capabilities: { unit: "celsius", range: [-40, 85] },
    sampling_rate_hz: 1,
    status: "online"
  },
  _running: false,
  _tick: 0,
  async start() { this._running = true; this.descriptor.status = "online"; },
  async stop() { this._running = false; this.descriptor.status = "offline"; },
  async read() {
    if (!this._running) throw new Error("Sensor not running");
    this._tick++;
    const temp = 22 + Math.sin(this._tick * 0.5) * 3 + (this._tick > 4 ? 8 : 0);
    return {
      sensor_id: "temp-sensor-01",
      timestamp: new Date().toISOString(),
      modality: "thermal",
      structured_data: { temperature: Math.round(temp * 10) / 10, unit: "celsius" },
      confidence: 0.92
    };
  }
};

const motionSensor = {
  descriptor: {
    sensor_id: "motion-sensor-01",
    sensor_type: "pir",
    modality: "motion",
    capabilities: { range_m: 8, field_of_view_deg: 120 },
    status: "online"
  },
  _running: false,
  _tick: 0,
  async start() { this._running = true; this.descriptor.status = "online"; },
  async stop() { this._running = false; this.descriptor.status = "offline"; },
  async read() {
    if (!this._running) throw new Error("Sensor not running");
    this._tick++;
    const detected = this._tick >= 2 && this._tick <= 4;
    return {
      sensor_id: "motion-sensor-01",
      timestamp: new Date().toISOString(),
      modality: "motion",
      structured_data: { detected, zone: detected ? "zone-A" : null },
      confidence: detected ? 0.88 : 0.95
    };
  }
};

const doorSensor = {
  descriptor: {
    sensor_id: "door-sensor-01",
    sensor_type: "contact",
    modality: "contact",
    capabilities: { type: "magnetic_reed" },
    status: "online"
  },
  _running: false,
  _tick: 0,
  async start() { this._running = true; this.descriptor.status = "online"; },
  async stop() { this._running = false; this.descriptor.status = "offline"; },
  async read() {
    if (!this._running) throw new Error("Sensor not running");
    this._tick++;
    const open = this._tick >= 3;
    return {
      sensor_id: "door-sensor-01",
      timestamp: new Date().toISOString(),
      modality: "contact",
      structured_data: { open, door_id: "main-entrance" },
      confidence: 0.99
    };
  }
};

const thermalProcessor = {
  name: "thermal-processor",
  supported_modalities: ["thermal"],
  async process(readings) {
    return readings.map((r) => ({
      percept_id: `percept-temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source_sensor_ids: [r.sensor_id],
      modality: r.modality,
      percept_type: "temperature_reading",
      timestamp: r.timestamp,
      data: { ...r.structured_data },
      confidence: r.confidence ?? 0.9,
      spatial_ref: { x: 5, y: 3 }
    }));
  }
};

const motionProcessor = {
  name: "motion-processor",
  supported_modalities: ["motion"],
  async process(readings) {
    return readings
      .filter((r) => r.structured_data?.detected)
      .map((r) => ({
        percept_id: `percept-motion-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source_sensor_ids: [r.sensor_id],
        modality: r.modality,
        percept_type: "occupancy",
        timestamp: r.timestamp,
        data: { occupied: true, zone: r.structured_data.zone },
        confidence: r.confidence ?? 0.85,
        spatial_ref: { x: 3, y: 2 }
      }));
  }
};

const contactProcessor = {
  name: "contact-processor",
  supported_modalities: ["contact"],
  async process(readings) {
    return readings.map((r) => ({
      percept_id: `percept-door-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source_sensor_ids: [r.sensor_id],
      modality: r.modality,
      percept_type: "door_state",
      timestamp: r.timestamp,
      data: { open: r.structured_data?.open, door_id: r.structured_data?.door_id },
      confidence: r.confidence ?? 0.95,
      spatial_ref: { x: 0, y: 5 }
    }));
  }
};

const registry = new InMemoryDeviceRegistry();
registry.registerSensor(temperatureSensor);
registry.registerSensor(motionSensor);
registry.registerSensor(doorSensor);

const pipeline = new DefaultPerceptionPipeline(3000);
pipeline.addProcessor(thermalProcessor);
pipeline.addProcessor(motionProcessor);
pipeline.addProcessor(contactProcessor);

const worldGraph = new InMemoryWorldStateGraph({
  confidence_decay_factor: 0.90,
  confidence_decay_interval_ms: 30000,
  prune_confidence_threshold: 0.15,
  default_entity_ttl_ms: 120000
});

worldGraph.addEntity({
  entity_id: "room-main",
  entity_type: "room",
  properties: { name: "Main Hall", area_m2: 50, max_occupancy: 20 },
  confidence: 1.0,
  last_observed: new Date().toISOString()
});
worldGraph.addEntity({
  entity_id: "hvac-01",
  entity_type: "actuator_device",
  properties: { type: "hvac", mode: "auto", target_temp: 24, status: "idle" },
  confidence: 1.0,
  last_observed: new Date().toISOString()
});
worldGraph.addRelation({
  relation_id: "rel-hvac-room",
  relation_type: "controls",
  source_entity_id: "hvac-01",
  target_entity_id: "room-main",
  strength: 1.0,
  confidence: 1.0,
  last_observed: new Date().toISOString()
});

const simulator = new RuleBasedSimulator();

await temperatureSensor.start();
await motionSensor.start();
await doorSensor.start();

let cycleCount = 0;

const reasoner = {
  name: "smart-room-reasoner",
  async plan(ctx) {
    return [{
      proposal_id: ctx.services.generateId("prp"),
      schema_version: ctx.profile.schema_version,
      session_id: ctx.session.session_id,
      cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
      module_name: this.name,
      proposal_type: "plan",
      salience_score: 0.9,
      confidence: 0.85,
      risk: 0.1,
      payload: { summary: "Monitor environment sensors and world state" },
      explanation: "Evaluate sensor data and determine if action is needed."
    }];
  },
  async respond(ctx) {
    cycleCount++;

    if (cycleCount <= 2) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: `Sensor check #${cycleCount}`,
        tool_name: "room_status",
        tool_args: { room_id: "room-main" },
        side_effect_level: "none"
      }];
    }

    if (cycleCount === 3) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "Activate cooling (high temp detected)",
        tool_name: "hvac_control",
        tool_args: { mode: "cooling", target_temp: 22 },
        side_effect_level: "medium",
        preconditions: ["entity:hvac-01:status=idle"]
      }];
    }

    if (cycleCount === 4) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "Post-action verification",
        tool_name: "room_status",
        tool_args: { room_id: "room-main" },
        side_effect_level: "none"
      }];
    }

    const snapshot = worldGraph.snapshot();
    const tempEntities = snapshot.entities.filter((e) => e.entity_type === "temperature_reading");
    const lastTemp = tempEntities.length > 0
      ? tempEntities[tempEntities.length - 1].properties.temperature
      : "unknown";
    const occupancy = snapshot.entities.filter((e) => e.entity_type === "occupancy");
    const doorEntities = snapshot.entities.filter((e) => e.entity_type === "door_state");
    const hvac = snapshot.entities.find((e) => e.entity_id === "hvac-01");

    const report = [
      `Temperature: ${lastTemp}°C`,
      `HVAC: ${hvac?.properties.mode} (target ${hvac?.properties.target_temp}°C)`,
      `Occupancy: ${occupancy.length > 0 ? occupancy.map((e) => e.properties.zone).join(", ") : "clear"}`,
      `Door: ${doorEntities.length > 0 ? (doorEntities[0].properties.open ? "OPEN" : "closed") : "unknown"}`,
      `Entities tracked: ${snapshot.entities.length}`,
      `Relations: ${snapshot.relations.length}`
    ].join(" | ");

    return [{
      action_id: ctx.services.generateId("act"),
      action_type: "respond",
      title: "Final environment report",
      description: report,
      side_effect_level: "none"
    }];
  }
};

const runtime = new AgentRuntime({
  reasoner,
  deviceRegistry: registry,
  worldStateGraph: worldGraph,
  perceptionPipeline: pipeline,
  forwardSimulator: simulator
});

runtime.tools.register({
  name: "room_status",
  description: "Returns the current status of a room from the world model.",
  sideEffectLevel: "none",
  inputSchema: {
    type: "object",
    properties: { room_id: { type: "string" } },
    required: ["room_id"]
  },
  async invoke(input) {
    const roomEntity = worldGraph.getEntity(input.room_id);
    const snapshot = worldGraph.snapshot();
    const related = snapshot.relations.filter(
      (r) => r.source_entity_id === input.room_id || r.target_entity_id === input.room_id
    );
    return {
      summary: roomEntity
        ? `Room "${roomEntity.properties.name}": ${snapshot.entities.length} entities tracked, ${related.length} relations`
        : `Room ${input.room_id} not found`,
      payload: {
        room: roomEntity?.properties,
        entity_count: snapshot.entities.length,
        relation_count: related.length
      }
    };
  }
});

runtime.tools.register({
  name: "hvac_control",
  description: "Controls the HVAC system.",
  sideEffectLevel: "medium",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["cooling", "heating", "auto", "off"] },
      target_temp: { type: "number" }
    },
    required: ["mode"]
  },
  async invoke(input) {
    worldGraph.updateEntity("hvac-01", {
      properties: { mode: input.mode, target_temp: input.target_temp, status: "active" }
    });
    return {
      summary: `HVAC set to ${input.mode} mode, target ${input.target_temp}°C`,
      payload: { mode: input.mode, target_temp: input.target_temp, activated: true }
    };
  }
});

const profile = {
  agent_id: "smart-room-agent",
  schema_version: "0.1.0",
  name: "Smart Room Monitor",
  version: "1.0.0",
  role: "Monitors a smart room environment using sensors, maintains a world model, and takes actions based on environmental changes.",
  mode: "embedded",
  tool_refs: ["room_status", "hvac_control"],
  skill_refs: [],
  policies: { policy_ids: [] },
  memory_config: {
    working_memory_enabled: true,
    episodic_memory_enabled: true,
    write_policy: "hybrid"
  },
  runtime_config: {
    max_cycles: 6,
    cycle_mode: "standard",
    checkpoint_interval: "cycle",
    auto_approve: true
  },
  metadata: {
    tool_catalog: [
      { name: "room_status", description: "Room status query", sideEffectLevel: "none" },
      { name: "hvac_control", description: "HVAC control", sideEffectLevel: "medium" }
    ]
  }
};

const session = runtime.createSession(profile, {
  agent_id: "smart-room-agent",
  tenant_id: "smart-building-01",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: "Monitor the room environment and report any anomalies. Take corrective action if temperature is too high.",
    created_at: new Date().toISOString()
  }
});

log("SESSION", `Created ${session.session_id}`);
line();

log("PHASE 1", "Initial World State (pre-loaded entities + relations)");
const initialSnapshot = worldGraph.snapshot();
for (const entity of initialSnapshot.entities) {
  const props = Object.entries(entity.properties)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  log("  ENTITY", `${entity.entity_id} [${entity.entity_type}] conf=${entity.confidence.toFixed(2)} | ${props}`);
}
for (const rel of initialSnapshot.relations) {
  log("  REL", `${rel.source_entity_id} --[${rel.relation_type}]--> ${rel.target_entity_id}`);
}
log("  DIGEST", worldGraph.toDigest().summary);
line();

log("PHASE 2", "Device Registry");
for (const d of registry.listAll()) {
  const desc = d.descriptor;
  log("  DEVICE", `${d.device_id} type=${desc.sensor_type ?? desc.actuator_type} modality=${desc.modality} health=${d.health_status}`);
}
line();

log("PHASE 3", "Running agent cognitive loop (Perceive → Predict → Act)...");
console.log();
const initialInput = {
  input_id: `inp_${Date.now()}`,
  content: "Monitor the room environment and report any anomalies. Take corrective action if temperature is too high.",
  created_at: new Date().toISOString()
};
const result = await runtime.runUntilSettled(profile, session.session_id, initialInput);

for (const [i, step] of result.steps.entries()) {
  const digest = step.cycle?.workspace?.world_state_digest;
  const preds = step.cycle?.predictions ?? [];
  const simPred = preds.find((p) => p.predictor_name === "simulation-based");
  const action = step.selectedAction;

  log(`  CYCLE ${i + 1}`, `action=${action?.action_type ?? "?"} tool=${action?.tool_name ?? "-"} side_effect=${action?.side_effect_level ?? "none"}`);
  if (digest) {
    log(`        `, `world: ${digest.summary} (uncertainty=${digest.uncertainty.toFixed(3)})`);
  }
  if (simPred) {
    log(`        `, `simulation: uncertainty=${simPred.uncertainty.toFixed(2)} success_prob=${simPred.success_probability?.toFixed(2) ?? "?"}`);
  }
  if (step.observation) {
    log(`        `, `observation: ${step.observation.summary?.slice(0, 80) ?? step.observation.status}`);
  }
}
console.log();

line();
log("RESULT", `Session → ${result.finalState} (${result.steps.length} cycles)`);
log("OUTPUT", result.outputText ?? "(no output)");
line();

log("PHASE 4", "Final World State (after 5 perceive cycles)");
const finalSnapshot = worldGraph.snapshot();
for (const entity of finalSnapshot.entities) {
  const props = Object.entries(entity.properties)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  log("  ENTITY", `${entity.entity_id} [${entity.entity_type}] conf=${entity.confidence.toFixed(2)} | ${props}`);
}
for (const rel of finalSnapshot.relations) {
  log("  REL", `${rel.source_entity_id} --[${rel.relation_type}]--> ${rel.target_entity_id} (str=${rel.strength.toFixed(1)})`);
}
log("  DIGEST", worldGraph.toDigest().summary);
line();

log("PHASE 5", "World State Evolution Across Cycles");
for (const [i, step] of result.steps.entries()) {
  const digest = step.cycle?.workspace?.world_state_digest;
  if (digest) {
    log(`  CYCLE ${i + 1}`, `${digest.summary} | uncertainty=${digest.uncertainty.toFixed(3)}`);
  }
}
line();

console.log();
log("DONE", "World model demo complete");
log("DONE", "Demonstrated: 3 sensors × 3 modalities → perception pipeline → entity graph");
log("DONE", "            → confidence tracking → forward simulation → corrective action");

await temperatureSensor.stop();
await motionSensor.stop();
await doorSensor.stop();
