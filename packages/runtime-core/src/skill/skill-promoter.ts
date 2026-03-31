import type { Episode, SkillDefinition, SideEffectLevel } from "@neurocore/protocol";

export function derivePatternKey(episode: Episode): string {
  const toolName =
    episode.metadata && typeof episode.metadata.tool_name === "string"
      ? episode.metadata.tool_name
      : "runtime";
  const normalizedStrategy = episode.selected_strategy.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48);
  return `${toolName}:${normalizedStrategy}`;
}

export function shouldPromoteToSkill(
  episodes: Episode[],
  patternKey: string,
  threshold = 3
): boolean {
  const successCount = episodes.filter(
    (ep) => ep.outcome === "success" && derivePatternKey(ep) === patternKey
  ).length;
  return successCount >= threshold;
}

export function compileSkillFromEpisodes(
  episodes: Episode[],
  patternKey: string,
  tenantId: string,
  generateId: (prefix: string) => string,
  now: () => string
): SkillDefinition {
  const matching = episodes.filter(
    (ep) => ep.outcome === "success" && derivePatternKey(ep) === patternKey
  );

  const [toolName] = patternKey.split(":");
  const hasToolName = toolName !== "runtime";

  const kind: SkillDefinition["kind"] = hasToolName ? "toolchain_skill" : "reasoning_skill";

  const triggerConditions = hasToolName
    ? [
        { field: "tool_name", operator: "eq" as const, value: toolName },
        ...(matching[0]?.metadata?.action_type
          ? [{ field: "action_type", operator: "eq" as const, value: matching[0].metadata.action_type as string }]
          : [])
      ]
    : [];

  const steps = matching.map((ep) => ep.selected_strategy);
  const uniqueSteps = [...new Set(steps)];

  const sideEffectLevels: SideEffectLevel[] = matching
    .map((ep) => ep.metadata?.side_effect_level as SideEffectLevel | undefined)
    .filter((level): level is SideEffectLevel => level !== undefined);
  const riskOrder: SideEffectLevel[] = ["none", "low", "medium", "high"];
  const maxRisk = sideEffectLevels.reduce<SideEffectLevel>((max, level) => {
    return riskOrder.indexOf(level) > riskOrder.indexOf(max) ? level : max;
  }, "none");
  const riskLevel = maxRisk === "none" || maxRisk === "low" ? "low" : maxRisk === "medium" ? "medium" : "high";

  return {
    skill_id: generateId("skl"),
    schema_version: "1.0.0",
    name: patternKey.replace(/[^a-z0-9:_]/g, "_"),
    version: "1.0.0",
    kind,
    description: `Auto-compiled from ${matching.length} successful episodes`,
    trigger_conditions: triggerConditions,
    execution_template: {
      kind: kind === "toolchain_skill" ? "toolchain" : "reasoning",
      steps: uniqueSteps
    },
    risk_level: riskLevel,
    fallback_policy: { on_failure: "reason" },
    metadata: {
      tenant_id: tenantId,
      source_episode_ids: matching.map((ep) => ep.episode_id),
      compiled_at: now(),
      pattern_key: patternKey
    }
  };
}
