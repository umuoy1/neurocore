import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createHomeAssistantTools,
  createPersonalAssistantConfigFromEnv,
  HomeAssistantRestClient,
  PersonalHomeAssistantService,
  startPersonalAssistantApp
} from "../examples/personal-assistant/dist/main.js";

test("Home Assistant fixture discovery dry-run approval execution readback and audit work end to end", async () => {
  const fixture = await startHomeAssistantFixture();
  const service = new PersonalHomeAssistantService({
    client: new HomeAssistantRestClient({
      baseUrl: fixture.baseUrl,
      accessToken: fixture.accessToken
    }),
    now: () => "2026-04-28T04:00:00.000Z",
    generateId: createCounterId()
  });

  try {
    const lights = await service.discoverEntities({ domain: "light" });
    assert.equal(lights.length, 1);
    assert.equal(lights[0].entity_id, "light.kitchen");

    const dryRun = await service.callService({
      entity_id: "light.kitchen",
      service: "turn_on",
      dry_run: true,
      actor_id: "operator"
    });
    assert.equal(dryRun.status, "dry_run");
    assert.equal(dryRun.dangerous, true);
    assert.equal(dryRun.requires_approval, true);
    assert.equal(dryRun.state_before.state, "off");
    assert.equal(fixture.serviceCalls.length, 0);

    const blocked = await service.callService({
      entity_id: "light.kitchen",
      service: "turn_on",
      actor_id: "operator"
    });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.error, /approved=true/);
    assert.equal(fixture.serviceCalls.length, 0);

    const executed = await service.callService({
      entity_id: "light.kitchen",
      service: "turn_on",
      approved: true,
      actor_id: "operator"
    });
    assert.equal(executed.status, "completed");
    assert.equal(executed.state_after.state, "on");
    assert.equal(fixture.serviceCalls.length, 1);

    const state = await service.readState({ entity_id: "light.kitchen", actor_id: "operator" });
    assert.equal(state.state, "on");

    const auditTypes = service.listAuditEvents({ limit: 20 }).map((event) => event.event_type);
    assert.ok(auditTypes.includes("entity_discovered"));
    assert.ok(auditTypes.includes("service_dry_run"));
    assert.ok(auditTypes.includes("service_blocked"));
    assert.ok(auditTypes.includes("service_called"));
    assert.ok(auditTypes.includes("state_readback"));
  } finally {
    await fixture.close();
  }
});

test("Home Assistant tools expose safe discovery state read service call and audit reports", async () => {
  const fixture = await startHomeAssistantFixture();
  const service = new PersonalHomeAssistantService({
    client: new HomeAssistantRestClient({
      baseUrl: fixture.baseUrl,
      accessToken: fixture.accessToken
    }),
    now: () => "2026-04-28T04:00:00.000Z",
    generateId: createCounterId()
  });
  const tools = new Map(createHomeAssistantTools(service).map((tool) => [tool.name, tool]));
  const ctx = { tenant_id: "tenant-ha", session_id: "session-ha", cycle_id: "cycle-ha" };

  try {
    assert.equal(tools.get("home_assistant_service_call").sideEffectLevel, "high");
    const discovered = await tools.get("home_assistant_entity_discover").invoke({ domain: "light" }, ctx);
    assert.equal(discovered.payload.entities.length, 1);

    const dryRun = await tools.get("home_assistant_service_call").invoke({
      entity_id: "light.kitchen",
      service: "turn_on",
      dry_run: true,
      actor_id: "operator"
    }, ctx);
    assert.match(dryRun.summary, /Dry-run light\.turn_on/);
    assert.equal(dryRun.payload.result.status, "dry_run");

    const executed = await tools.get("home_assistant_service_call").invoke({
      entity_id: "light.kitchen",
      service: "turn_on",
      approved: true,
      actor_id: "operator"
    }, ctx);
    assert.match(executed.summary, /state=on/);
    assert.equal(executed.payload.result.state_after.state, "on");

    const state = await tools.get("home_assistant_state_read").invoke({
      entity_id: "light.kitchen",
      actor_id: "operator"
    }, ctx);
    assert.match(state.summary, /light\.kitchen is on/);

    const audit = await tools.get("home_assistant_audit_list").invoke({ limit: 20 }, ctx);
    assert.ok(audit.payload.events.some((event) => event.event_type === "state_readback"));
  } finally {
    await fixture.close();
  }
});

test("personal assistant config and app wire Home Assistant tools through scoped credentials", async () => {
  const fixture = await startHomeAssistantFixture();
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-ha-app-"));
  const config = createPersonalAssistantConfigFromEnv({
    HOME_ASSISTANT_ENABLED: "true",
    HOME_ASSISTANT_BASE_URL: fixture.baseUrl,
    HOME_ASSISTANT_ACCESS_TOKEN: fixture.accessToken
  }, { cwd: tempDir });
  const app = await startPersonalAssistantApp({
    ...config,
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-ha",
    reasoner: createReasoner(),
    web_chat: {
      enabled: false
    }
  });

  try {
    assert.equal(config.home_assistant.enabled, true);
    assert.equal(config.home_assistant.base_url, fixture.baseUrl);
    assert.ok(app.homeAssistantService);
    assert.ok(app.builder.getProfile().tool_refs.includes("home_assistant_entity_discover"));
    assert.ok(app.builder.getProfile().tool_refs.includes("home_assistant_service_call"));
    const entities = await app.homeAssistantService.discoverEntities({ query: "kitchen" });
    assert.equal(entities[0].entity_id, "light.kitchen");
  } finally {
    await app.close();
    await fixture.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function startHomeAssistantFixture() {
  const accessToken = "ha-fixture-token";
  const states = new Map([
    ["light.kitchen", {
      entity_id: "light.kitchen",
      state: "off",
      attributes: {
        friendly_name: "Kitchen Light",
        supported_features: 1
      },
      last_changed: "2026-04-28T04:00:00.000Z",
      last_updated: "2026-04-28T04:00:00.000Z"
    }],
    ["sensor.living_room_temperature", {
      entity_id: "sensor.living_room_temperature",
      state: "21.5",
      attributes: {
        friendly_name: "Living Room Temperature",
        unit_of_measurement: "C"
      },
      last_changed: "2026-04-28T04:00:00.000Z",
      last_updated: "2026-04-28T04:00:00.000Z"
    }]
  ]);
  const serviceCalls = [];

  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.method === "GET" && req.url === "/api/states") {
      sendJson(res, 200, [...states.values()]);
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/states/")) {
      const entityId = decodeURIComponent(req.url.slice("/api/states/".length));
      const entity = states.get(entityId);
      if (!entity) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      sendJson(res, 200, entity);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/services/")) {
      const [, , , domain, service] = req.url.split("/");
      const body = await readRequestJson(req);
      const entityId = body.entity_id;
      serviceCalls.push({ domain, service, body });
      const entity = states.get(entityId);
      if (entity) {
        const nextState = service === "turn_on" ? "on" : service === "turn_off" ? "off" : entity.state;
        states.set(entityId, {
          ...entity,
          state: nextState,
          last_changed: "2026-04-28T04:01:00.000Z",
          last_updated: "2026-04-28T04:01:00.000Z"
        });
      }
      sendJson(res, 200, { changed: Boolean(entity), entity_id: entityId });
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    accessToken,
    serviceCalls,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text.length > 0 ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function createCounterId() {
  let counter = 0;
  return (prefix) => {
    counter += 1;
    return `${prefix}_${counter}`;
  };
}

function createReasoner() {
  return {
    name: "home-assistant-test-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "home-assistant-test-reasoner",
        proposal_type: "plan",
        salience_score: 0.5,
        confidence: 0.8,
        risk: 0,
        payload: { summary: "home assistant test" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "home assistant",
        description: "home assistant test",
        side_effect_level: "none"
      }];
    }
  };
}
