import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "@neurocore/runtime-core";
import {
  ConfidenceWeightedFusionStrategy,
  InMemoryDeviceRegistry,
  MockSpeakerActuator,
  MockCameraSensor,
  DefaultActuatorOrchestrator,
  DefaultPerceptionPipeline
} from "@neurocore/device-core";
import {
  DefaultActiveInferenceEvaluator,
  InMemoryWorldStateGraph,
  RuleBasedSimulator
} from "@neurocore/world-model";

function ts() {
  return new Date().toISOString();
}

function makeProfile(overrides = {}) {
  return {
    agent_id: "test-agent",
    schema_version: "0.1.0",
    name: "TestAgent",
    version: "0.1.0",
    role: "test",
    mode: "runtime",
    tool_refs: [],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: { working_memory_enabled: true, episodic_memory_enabled: true, write_policy: "immediate" },
    runtime_config: { max_cycles: 3, auto_approve: true },
    ...overrides
  };
}

function makeReasoner() {
  return {
    name: "test-reasoner",
    async plan() {
      return [{
        proposal_id: "prop_1",
        schema_version: "0.1.0",
        session_id: "",
        cycle_id: "",
        module_name: "test-reasoner",
        proposal_type: "context",
        salience_score: 0.8,
        payload: { summary: "test" }
      }];
    },
    async respond() {
      return [{
        action_id: "act_1",
        action_type: "respond",
        title: "Respond",
        expected_outcome: "Done"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function makeVisualProcessor() {
  return {
    name: "visual",
    supported_modalities: ["visual"],
    async process(readings) {
      return readings.map((r, i) => ({
        percept_id: `vp-${i}`,
        source_sensor_ids: [r.sensor_id],
        modality: "visual",
        percept_type: "object_detection",
        timestamp: r.timestamp,
        data: { label: "test-object", frame: r.structured_data?.frame_number ?? 0 },
        confidence: 0.9
      }));
    }
  };
}

test("Integration: perceive phase populates world_state_digest when device components injected", async () => {
  const registry = new InMemoryDeviceRegistry();
  const sensor = new MockCameraSensor("cam-int");
  await sensor.start();
  registry.registerSensor(sensor);

  const pipeline = new DefaultPerceptionPipeline();
  pipeline.addProcessor(makeVisualProcessor());

  const graph = new InMemoryWorldStateGraph();
  const fusion = new ConfidenceWeightedFusionStrategy();

  const profile = makeProfile();
  const runtime = new AgentRuntime({
    reasoner: makeReasoner(),
    deviceRegistry: registry,
    perceptionPipeline: pipeline,
    sensorFusionStrategy: fusion,
    worldStateGraph: graph
  });

  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "t1",
    initial_input: { input_id: "inp_1", content: "test device integration", created_at: ts() }
  });

  const result = await runtime.runOnce(
    profile,
    session.session_id,
    { input_id: "inp_2", content: "test device integration", created_at: ts() }
  );

  const worldSnapshot = graph.snapshot();
  assert.ok(worldSnapshot.entities.length > 0, "WorldStateGraph should have entities from perception");

  const digest = graph.toDigest();
  assert.ok(digest.summary.includes("entities"));
  assert.ok(worldSnapshot.entities.length <= 1, "sensor fusion should merge same-object percepts");

  const ws = result.cycle.workspace;
  assert.ok(ws.world_state_digest, "workspace should have world_state_digest");
  assert.ok(ws.world_state_digest.summary.includes("entities"));

  await sensor.stop();
});

test("Integration: forwardSimulator injection adds simulation-based predictions", async () => {
  const graph = new InMemoryWorldStateGraph();
  const simulator = new RuleBasedSimulator();
  const evaluator = new DefaultActiveInferenceEvaluator();

  const profile = makeProfile({ runtime_config: { max_cycles: 1, auto_approve: true } });
  const runtime = new AgentRuntime({
    reasoner: {
      name: "test-reasoner",
      async plan() { return []; },
      async respond() {
        return [{
          action_id: "act_sim",
          action_type: "call_tool",
          title: "Test simulation",
          side_effect_level: "low"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    },
    worldStateGraph: graph,
    forwardSimulator: simulator,
    activeInferenceEvaluator: evaluator
  });

  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "t1",
    initial_input: { input_id: "inp_1", content: "test simulation", created_at: ts() }
  });

  const result = await runtime.runOnce(
    profile,
    session.session_id,
    { input_id: "inp_2", content: "test simulation predictions", created_at: ts() }
  );

  const simPredictions = result.cycle.predictions.filter(
    (p) => p.predictor_name === "simulation-based"
  );
  assert.ok(simPredictions.length > 0, "Should have simulation-based predictions");
  assert.ok(simPredictions[0].success_probability > 0);
  assert.equal(typeof simPredictions[0].expected_free_energy, "number");
  assert.ok(result.cycle.metaSignalFrame?.prediction_signals.expected_free_energy_score != null);
});

test("Integration: actuator orchestrator executes device command path", async () => {
  const registry = new InMemoryDeviceRegistry();
  const speaker = new MockSpeakerActuator("speaker-1");
  await speaker.initialize();
  registry.registerActuator(speaker);

  const profile = makeProfile({ runtime_config: { max_cycles: 1, auto_approve: true } });
  const runtime = new AgentRuntime({
    reasoner: {
      name: "device-reasoner",
      async plan() { return []; },
      async respond() {
        return [{
          action_id: "act_device",
          action_type: "call_tool",
          title: "Speak through actuator",
          tool_name: "device.orchestrate",
          tool_args: {
            execution_strategy: "serial",
            commands: [{
              actuator_id: "speaker-1",
              command_type: "speak",
              parameters: { text: "hello device" }
            }]
          },
          side_effect_level: "low"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    },
    deviceRegistry: registry,
    actuatorOrchestrator: new DefaultActuatorOrchestrator()
  });

  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "t1",
    initial_input: { input_id: "inp_1", content: "speak", created_at: ts() }
  });

  const result = await runtime.runOnce(
    profile,
    session.session_id,
    { input_id: "inp_2", content: "speak now", created_at: ts() }
  );

  assert.equal(result.observation?.status, "success");
  assert.equal(result.observation?.structured_payload?.tool_name, "device.orchestrate");
  assert.equal(result.observation?.structured_payload?.results?.[0]?.status, "completed");
  await speaker.stop();
});

test("Integration: no device injection preserves existing behavior (regression)", async () => {
  const profile = makeProfile({ runtime_config: { max_cycles: 1, auto_approve: true } });
  const runtime = new AgentRuntime({
    reasoner: {
      name: "test-reasoner",
      async plan() { return []; },
      async respond() {
        return [{ action_id: "act_1", action_type: "complete", title: "Done" }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    }
  });

  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "t1",
    initial_input: { input_id: "inp_1", content: "test backward compat", created_at: ts() }
  });

  const result = await runtime.runOnce(
    profile,
    session.session_id,
    { input_id: "inp_2", content: "test backward compat", created_at: ts() }
  );

  assert.ok(result.cycle.workspace);
  assert.equal(result.cycle.workspace.world_state_digest, undefined);
});
