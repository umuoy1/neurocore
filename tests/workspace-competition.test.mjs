import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceCoordinator } from "@neurocore/runtime-core";

function makeProposal(overrides) {
  return {
    proposal_id: `prop_${Math.random().toString(36).slice(2, 8)}`,
    schema_version: "0.1.0",
    session_id: "ses_1",
    cycle_id: "cyc_1",
    module_name: "test-module",
    proposal_type: "plan",
    salience_score: 0.5,
    confidence: 0.7,
    payload: {},
    ...overrides
  };
}

function makeGoal(overrides) {
  return {
    goal_id: `goal_${Math.random().toString(36).slice(2, 8)}`,
    schema_version: "0.1.0",
    session_id: "ses_1",
    title: "test goal",
    goal_type: "task",
    status: "active",
    priority: 1,
    ...overrides
  };
}

function makeInput(proposals, goals = []) {
  return {
    sessionId: "ses_1",
    cycleId: "cyc_1",
    contextSummary: "test context",
    goals,
    proposals,
    candidateActions: [],
    budgetState: {}
  };
}

test("W1: single proposal produces correct competition entry", () => {
  const coord = new WorkspaceCoordinator();
  const proposal = makeProposal({
    proposal_id: "p1",
    module_name: "reasoner",
    proposal_type: "plan",
    salience_score: 0.8,
    payload: { text: "analyze data" }
  });
  const snapshot = coord.buildSnapshot(makeInput([proposal]));
  assert.equal(snapshot.selected_proposal_id, "p1");
  assert.ok(snapshot.competition_log);
  assert.equal(snapshot.competition_log.entries.length, 1);
  const entry = snapshot.competition_log.entries[0];
  assert.equal(entry.proposal_id, "p1");
  assert.equal(entry.source, "reasoner");
  assert.equal(entry.rank, 1);
  assert.equal(entry.raw_salience, 0.8);
  assert.equal(entry.source_weight, 1.0);
  assert.ok(entry.final_score > 0);
});

test("W2: multiple proposals ranked correctly", () => {
  const coord = new WorkspaceCoordinator();
  const p1 = makeProposal({
    proposal_id: "p1",
    salience_score: 0.9,
    proposal_type: "plan",
    module_name: "reasoner",
    payload: { text: "high salience plan" }
  });
  const p2 = makeProposal({
    proposal_id: "p2",
    salience_score: 0.5,
    proposal_type: "memory_recall",
    module_name: "memory",
    payload: { text: "recall something" }
  });
  const p3 = makeProposal({
    proposal_id: "p3",
    salience_score: 0.7,
    proposal_type: "skill_match",
    module_name: "skill",
    payload: { text: "match skill" }
  });

  const snapshot = coord.buildSnapshot(makeInput([p1, p2, p3]));
  assert.equal(snapshot.selected_proposal_id, "p1");
  const log = snapshot.competition_log;
  assert.equal(log.entries.length, 3);
  assert.equal(log.entries[0].rank, 1);
  assert.equal(log.entries[0].proposal_id, "p1");
  assert.equal(log.entries[1].rank, 2);
  assert.equal(log.entries[2].rank, 3);
});

test("W3: overlapping proposals trigger salience fusion", () => {
  const coord = new WorkspaceCoordinator();
  const p1 = makeProposal({
    proposal_id: "p1",
    salience_score: 0.6,
    proposal_type: "plan",
    module_name: "reasoner",
    payload: { text: "analyze the quarterly sales data" }
  });
  const p2 = makeProposal({
    proposal_id: "p2",
    salience_score: 0.5,
    proposal_type: "plan",
    module_name: "reasoner-2",
    payload: { text: "analyze quarterly sales data trends" }
  });

  const snapshot = coord.buildSnapshot(makeInput([p1, p2]));
  const log = snapshot.competition_log;
  const fusedEntry = log.entries.find((e) => e.fused_with && e.fused_with.length > 0);
  assert.ok(fusedEntry, "expected a fused entry");
  assert.ok(fusedEntry.raw_salience > 0.6, "fused salience should exceed primary");
  assert.ok(fusedEntry.raw_salience <= 1.0, "fused salience capped at 1.0");
});

test("W4: score gap below threshold marks conflict", () => {
  const coord = new WorkspaceCoordinator({ conflictThreshold: 0.1 });
  const p1 = makeProposal({
    proposal_id: "p1",
    salience_score: 0.80,
    proposal_type: "plan",
    module_name: "module-a",
    payload: { text: "do task A" }
  });
  const p2 = makeProposal({
    proposal_id: "p2",
    salience_score: 0.79,
    proposal_type: "action",
    module_name: "module-b",
    payload: { text: "do task B" }
  });

  const snapshot = coord.buildSnapshot(makeInput([p1, p2]));
  const log = snapshot.competition_log;
  assert.ok(log.conflicts.length > 0, "expected at least one conflict");
  assert.equal(log.conflicts[0].conflict_type, "overlapping_action");
  assert.ok(log.conflicts[0].score_gap < 0.1);
});

test("W5: goal alignment boosts matching proposal score", () => {
  const coord = new WorkspaceCoordinator();
  const goal = makeGoal({
    title: "optimize database query performance",
    description: "improve database query speed",
    status: "active"
  });

  const pAligned = makeProposal({
    proposal_id: "p_aligned",
    salience_score: 0.5,
    proposal_type: "plan",
    module_name: "reasoner",
    payload: { text: "optimize database query performance indexing" }
  });
  const pUnaligned = makeProposal({
    proposal_id: "p_unaligned",
    salience_score: 0.5,
    proposal_type: "plan",
    module_name: "reasoner",
    payload: { text: "send email notification" }
  });

  const snapshot = coord.buildSnapshot(makeInput([pAligned, pUnaligned], [goal]));
  assert.equal(snapshot.selected_proposal_id, "p_aligned");
  const log = snapshot.competition_log;
  const alignedEntry = log.entries.find((e) => e.proposal_id === "p_aligned");
  const unalignedEntry = log.entries.find((e) => e.proposal_id === "p_unaligned");
  assert.ok(alignedEntry.goal_alignment > unalignedEntry.goal_alignment);
  assert.ok(alignedEntry.final_score > unalignedEntry.final_score);
});

test("W6: zero proposals produces valid snapshot", () => {
  const coord = new WorkspaceCoordinator();
  const snapshot = coord.buildSnapshot(makeInput([]));
  assert.equal(snapshot.selected_proposal_id, undefined);
  assert.ok(snapshot.competition_log);
  assert.equal(snapshot.competition_log.entries.length, 0);
  assert.equal(snapshot.competition_log.conflicts.length, 0);
  assert.ok(snapshot.competition_log.selection_reasoning.includes("No proposals"));
});

test("W7: custom sourceWeights change competition outcome", () => {
  const coord = new WorkspaceCoordinator({
    sourceWeights: { reasoner: 0.5, memory: 1.5, skill: 0.9 }
  });

  const pReasoner = makeProposal({
    proposal_id: "p_reasoner",
    salience_score: 0.7,
    proposal_type: "plan",
    module_name: "reasoner",
    payload: { text: "reasoner plan" }
  });
  const pMemory = makeProposal({
    proposal_id: "p_memory",
    salience_score: 0.7,
    proposal_type: "memory_recall",
    module_name: "memory",
    payload: { text: "memory recall" }
  });

  const snapshot = coord.buildSnapshot(makeInput([pReasoner, pMemory]));
  assert.equal(snapshot.selected_proposal_id, "p_memory");
  const log = snapshot.competition_log;
  const memEntry = log.entries.find((e) => e.proposal_id === "p_memory");
  const reasEntry = log.entries.find((e) => e.proposal_id === "p_reasoner");
  assert.ok(memEntry.final_score > reasEntry.final_score);
});

test("W8: selection_reasoning contains interpretable information", () => {
  const coord = new WorkspaceCoordinator();
  const p1 = makeProposal({
    proposal_id: "p1",
    module_name: "planner",
    proposal_type: "plan",
    salience_score: 0.9,
    payload: { text: "plan action" }
  });
  const p2 = makeProposal({
    proposal_id: "p2",
    module_name: "recall",
    proposal_type: "memory_recall",
    salience_score: 0.4,
    payload: { text: "recall info" }
  });

  const snapshot = coord.buildSnapshot(makeInput([p1, p2]));
  const reasoning = snapshot.competition_log.selection_reasoning;
  assert.ok(reasoning.includes("planner"));
  assert.ok(reasoning.includes("final_score"));
  assert.ok(reasoning.includes("raw_salience"));
  assert.ok(reasoning.includes("Runner-up"));
});
