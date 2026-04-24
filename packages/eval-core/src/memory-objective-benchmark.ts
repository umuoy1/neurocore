export interface MemoryObjectiveBenchmarkCase {
  case_id: string;
  expected_episode_ids?: string[];
  recalled_episode_ids?: string[];
  expected_card_ids?: string[];
  recalled_card_ids?: string[];
  expected_skill_spec_ids?: string[];
  recalled_skill_spec_ids?: string[];
  disallowed_object_ids?: string[];
  returned_object_ids?: string[];
}

export interface MemoryObjectiveBenchmarkReport {
  case_count: number;
  episodic_recall: number;
  episodic_precision: number;
  semantic_card_recall: number;
  semantic_card_precision: number;
  skill_spec_recall: number;
  skill_spec_precision: number;
  governance_exclusion_rate: number;
  objective_score: number;
}

export function evaluateMemoryObjectiveBenchmark(
  cases: MemoryObjectiveBenchmarkCase[]
): MemoryObjectiveBenchmarkReport {
  if (cases.length === 0) {
    return {
      case_count: 0,
      episodic_recall: 0,
      episodic_precision: 0,
      semantic_card_recall: 0,
      semantic_card_precision: 0,
      skill_spec_recall: 0,
      skill_spec_precision: 0,
      governance_exclusion_rate: 0,
      objective_score: 0
    };
  }

  const report: MemoryObjectiveBenchmarkReport = {
    case_count: cases.length,
    episodic_recall: average(cases.map((item) => recall(item.expected_episode_ids, item.recalled_episode_ids))),
    episodic_precision: average(cases.map((item) => precision(item.expected_episode_ids, item.recalled_episode_ids))),
    semantic_card_recall: average(cases.map((item) => recall(item.expected_card_ids, item.recalled_card_ids))),
    semantic_card_precision: average(cases.map((item) => precision(item.expected_card_ids, item.recalled_card_ids))),
    skill_spec_recall: average(cases.map((item) => recall(item.expected_skill_spec_ids, item.recalled_skill_spec_ids))),
    skill_spec_precision: average(cases.map((item) => precision(item.expected_skill_spec_ids, item.recalled_skill_spec_ids))),
    governance_exclusion_rate: average(cases.map((item) => governanceExclusion(item.disallowed_object_ids, item.returned_object_ids))),
    objective_score: 0
  };

  report.objective_score = clamp01(
    report.episodic_recall * 0.2 +
      report.episodic_precision * 0.15 +
      report.semantic_card_recall * 0.15 +
      report.semantic_card_precision * 0.1 +
      report.skill_spec_recall * 0.15 +
      report.skill_spec_precision * 0.1 +
      report.governance_exclusion_rate * 0.15
  );

  return report;
}

function recall(expected: string[] | undefined, actual: string[] | undefined): number {
  const expectedSet = new Set(expected ?? []);
  if (expectedSet.size === 0) {
    return 1;
  }
  const actualSet = new Set(actual ?? []);
  let hits = 0;
  for (const id of expectedSet) {
    if (actualSet.has(id)) {
      hits += 1;
    }
  }
  return hits / expectedSet.size;
}

function precision(expected: string[] | undefined, actual: string[] | undefined): number {
  const actualSet = new Set(actual ?? []);
  if (actualSet.size === 0) {
    return expected && expected.length > 0 ? 0 : 1;
  }
  const expectedSet = new Set(expected ?? []);
  let hits = 0;
  for (const id of actualSet) {
    if (expectedSet.has(id)) {
      hits += 1;
    }
  }
  return hits / actualSet.size;
}

function governanceExclusion(disallowed: string[] | undefined, returned: string[] | undefined): number {
  const disallowedSet = new Set(disallowed ?? []);
  if (disallowedSet.size === 0) {
    return 1;
  }
  const returnedSet = new Set(returned ?? []);
  let blocked = 0;
  for (const id of disallowedSet) {
    if (!returnedSet.has(id)) {
      blocked += 1;
    }
  }
  return blocked / disallowedSet.size;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
