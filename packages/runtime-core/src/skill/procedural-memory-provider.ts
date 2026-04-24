import type {
  ActionExecution,
  CandidateAction,
  Episode,
  SkillCandidate,
  SkillEvaluation,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  ProceduralMemorySnapshot,
  ProceduralSkillSpec,
  Proposal,
  SkillDefinition,
  SkillEvaluator,
  SkillPolicy,
  SkillSelection,
  SkillTransferResult,
  SkillTransferEngine,
  SkillProvider,
  SkillStore
} from "@neurocore/protocol";
import { InMemorySkillStore } from "./in-memory-skill-store.js";
import {
  derivePatternKey,
  shouldPromoteToSkill,
  compileSkillFromEpisodes
} from "./skill-promoter.js";
import { generateId, nowIso } from "../utils/ids.js";

interface TenantEpisodeGroup {
  tenantId: string;
  episodes: Episode[];
}

export class ProceduralMemoryProvider implements MemoryProvider, SkillProvider {
  public readonly name = "procedural-memory-provider";
  public readonly layer = "procedural" as const;

  private readonly store: SkillStore;
  private readonly promotionThreshold: number;
  private readonly skillPolicy?: SkillPolicy;
  private readonly skillEvaluator?: SkillEvaluator;
  private readonly transferEngine?: SkillTransferEngine;
  private readonly tenantBySession = new Map<string, string>();
  private readonly episodesBySession = new Map<string, Episode[]>();
  private readonly episodesByTenantPattern = new Map<string, TenantEpisodeGroup>();
  private lastPromotedSkill: SkillDefinition | null = null;
  private lastSelection: SkillSelection | null = null;
  private lastEvaluations: SkillEvaluation[] = [];
  private lastPrunedSkills: SkillDefinition[] = [];
  private lastTransferredSkill: SkillDefinition | null = null;
  private lastTransferResult: SkillTransferResult | null = null;

  public constructor(
    store?: SkillStore,
    promotionThreshold = 3,
    skillPolicy?: SkillPolicy,
    skillEvaluator?: SkillEvaluator,
    transferEngine?: SkillTransferEngine
  ) {
    this.store = store ?? new InMemorySkillStore();
    this.promotionThreshold = promotionThreshold;
    this.skillPolicy = skillPolicy;
    this.skillEvaluator = skillEvaluator;
    this.transferEngine = transferEngine;
  }

  public getStore(): SkillStore {
    return this.store;
  }

  public getLastPromotedSkill(): SkillDefinition | null {
    return this.lastPromotedSkill;
  }

  public clearLastPromotedSkill(): void {
    this.lastPromotedSkill = null;
  }

  public getLastSelection(): SkillSelection | null {
    return this.lastSelection;
  }

  public clearLastSelection(): void {
    this.lastSelection = null;
  }

  public drainLastEvaluations(): SkillEvaluation[] {
    const next = this.lastEvaluations;
    this.lastEvaluations = [];
    return next;
  }

  public drainLastPrunedSkills(): SkillDefinition[] {
    const next = this.lastPrunedSkills;
    this.lastPrunedSkills = [];
    return next;
  }

  public getLastTransferredSkill(): SkillDefinition | null {
    return this.lastTransferredSkill;
  }

  public clearLastTransferredSkill(): void {
    this.lastTransferredSkill = null;
  }

  public getLastTransferResult(): SkillTransferResult | null {
    return this.lastTransferResult;
  }

  public clearLastTransferResult(): void {
    this.lastTransferResult = null;
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    if (ctx.profile.memory_config.procedural_memory_enabled === false) {
      return [];
    }

    this.lastSelection = null;
    this.lastTransferredSkill = null;
    this.lastTransferResult = null;

    const triggerContext = this.buildTriggerContext(ctx);
    const skills = this.resolveCandidateSkills(ctx, triggerContext);
    if (skills.length === 0) return [];

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    if (!ctx.profile.rl_config?.enabled || !this.skillPolicy) {
      return skills.map((skill) => ({
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: cycleId,
        module_name: this.name,
        proposal_type: "skill_match" as const,
        salience_score: 0.88,
        confidence: 0.85,
        risk: 0,
        payload: {
          skill_id: skill.skill_id,
          skill_name: skill.name,
          name: skill.name,
          kind: skill.kind,
          version: skill.version,
          tool_name: this.getTriggerConditionValue(skill, "tool_name"),
          action_type: this.getTriggerConditionValue(skill, "action_type"),
          default_tool_args: skill.execution_template.default_args,
          execution_template: skill.execution_template,
          trigger_conditions: skill.trigger_conditions,
          risk_level: skill.risk_level
        },
        explanation: `Matched skill "${skill.name}" (${skill.kind}) based on trigger conditions.`
      }));
    }

    const candidates = skills.map((skill) => this.toSkillCandidate(ctx, cycleId, skill));
    const selection = await this.skillPolicy.selectSkill({
      tenant_id: ctx.tenant_id,
      session_id: ctx.session.session_id,
      cycle_id: cycleId,
      candidates,
      profile: ctx.profile,
      runtime_state: ctx.runtime_state
    });
    this.lastSelection = selection;
    if (!selection) {
      return [];
    }

    const selectedSkill = skills.find((skill) => skill.skill_id === selection.skill_id);
    if (!selectedSkill) {
      return [];
    }

    const selectedCandidate = candidates.find((candidate) => candidate.skill_id === selection.skill_id);
    if (!selectedCandidate) {
      return [];
    }

    return [{
      proposal_id: ctx.services.generateId("prp"),
      schema_version: ctx.profile.schema_version,
      session_id: ctx.session.session_id,
      cycle_id: cycleId,
      module_name: this.name,
      proposal_type: "skill_match" as const,
      salience_score: clamp(0.4 + selectedCandidate.q_value * 0.5, 0.05, 0.99),
      confidence: selection.confidence,
      risk: 0,
      payload: {
        skill_id: selectedSkill.skill_id,
        skill_name: selectedSkill.name,
        name: selectedSkill.name,
        kind: selectedSkill.kind,
        version: selectedSkill.version,
        tool_name: this.getTriggerConditionValue(selectedSkill, "tool_name"),
        action_type: this.getTriggerConditionValue(selectedSkill, "action_type"),
        default_tool_args: selectedSkill.execution_template.default_args,
        execution_template: selectedSkill.execution_template,
        trigger_conditions: selectedSkill.trigger_conditions,
        risk_level: selectedSkill.risk_level,
        selection_reason: selection.selection_reason,
        policy_score: selection.policy_score,
        selection_strategy: selection.strategy
      },
      explanation: selection.rationale
    }];
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    if (ctx.profile.memory_config.procedural_memory_enabled === false) {
      return [];
    }

    const skills = this.store.list(ctx.tenant_id);
    return skills.slice(0, ctx.memory_config?.retrieval_top_k ?? 3).map((skill) => ({
      memory_id: skill.skill_id,
      memory_type: "procedural" as const,
      summary: `${skill.name} (${skill.kind}): ${skill.description ?? ""}`,
      relevance: 0.8
    }));
  }

  public async writeEpisode(ctx: ModuleContext, episode: Episode): Promise<void> {
    if (ctx.profile.memory_config.procedural_memory_enabled === false) {
      return;
    }

    this.tenantBySession.set(episode.session_id, ctx.tenant_id);
    this.lastPromotedSkill = null;

    if (episode.outcome !== "success") return;

    const patternKey = derivePatternKey(episode);
    this.addEpisodeToSession(episode.session_id, episode);
    this.addEpisodeToPatternGroup(ctx.tenant_id, episode);

    const promoted = this.reconcilePatternSkill(
      ctx.tenant_id,
      patternKey,
      ctx.services.generateId.bind(ctx.services),
      ctx.services.now.bind(ctx.services),
      ctx.profile.domain ? [ctx.profile.domain] : undefined
    );
    if (promoted) {
      this.lastPromotedSkill = promoted;
    }
  }

  public async match(ctx: ModuleContext): Promise<Proposal[]> {
    return this.retrieve(ctx);
  }

  public async execute(
    ctx: ModuleContext,
    skillId: string,
    action: CandidateAction
  ): Promise<ActionExecution | null> {
    void ctx;
    void skillId;
    void action;
    return null;
  }

  public deleteSession(sessionId: string): void {
    const tenantId = this.tenantBySession.get(sessionId);
    const affectedPatternKeys = this.removeSessionEpisodes(sessionId);
    if (tenantId) {
      for (const patternKey of affectedPatternKeys) {
        this.reconcilePatternSkill(tenantId, patternKey);
      }
    }
    this.tenantBySession.delete(sessionId);
  }

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    const affectedPatternKeys = this.removeSessionEpisodes(sessionId);
    this.tenantBySession.set(sessionId, tenantId);
    for (const episode of episodes) {
      if (episode.outcome !== "success") {
        continue;
      }

      this.addEpisodeToSession(sessionId, episode);
      this.addEpisodeToPatternGroup(tenantId, episode);
      affectedPatternKeys.add(derivePatternKey(episode));
    }

    for (const patternKey of affectedPatternKeys) {
      this.reconcilePatternSkill(tenantId, patternKey);
    }
  }

  public hydrateSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.removeSessionEpisodes(sessionId);
    this.tenantBySession.set(sessionId, tenantId);

    for (const episode of episodes) {
      if (episode.outcome !== "success") {
        continue;
      }

      this.addEpisodeToSession(sessionId, episode);
      this.addEpisodeToPatternGroup(tenantId, episode);
    }
  }

  public buildSnapshot(sessionId: string): ProceduralMemorySnapshot {
    const tenantId = this.tenantBySession.get(sessionId);
    if (!tenantId) {
      return { skills: [] };
    }

    const episodes = this.episodesBySession.get(sessionId) ?? [];
    if (episodes.length === 0) {
      return { skills: [] };
    }

    const episodeIds = new Set(episodes.map((episode) => episode.episode_id));
    const patternKeys = new Set(episodes.map((episode) => derivePatternKey(episode)));
    const skills = this.store.list(tenantId).filter((skill) => {
      const metadata = this.readSkillMetadata(skill);
      const sourceEpisodeIds = this.readSkillSourceEpisodeIds(skill);
      return (
        sourceEpisodeIds.some((episodeId) => episodeIds.has(episodeId)) ||
        (metadata.patternKey !== undefined && patternKeys.has(metadata.patternKey))
      );
    });

    return {
      skills,
      skill_specs: skills.map((skill) => this.toSkillSpec(tenantId, skill))
    };
  }

  public restoreSnapshot(tenantId: string, snapshot?: ProceduralMemorySnapshot): void {
    if (!snapshot?.skills?.length) {
      return;
    }

    for (const skill of snapshot.skills) {
      const metadata = this.readSkillMetadata(skill);
      const tenantScopedSkill: SkillDefinition = {
        ...structuredClone(skill),
        metadata: {
          ...(skill.metadata ?? {}),
          tenant_id: metadata.tenantId ?? tenantId
        }
      };
      this.store.save(tenantScopedSkill);
    }
  }

  public listSkills(tenantId: string): SkillDefinition[] {
    return this.store.list(tenantId);
  }

  public listSkillSpecs(tenantId: string): ProceduralSkillSpec[] {
    return this.listSkills(tenantId).map((skill) => this.toSkillSpec(tenantId, skill));
  }

  public markSkillSpecsByEpisodeIds(
    tenantId: string,
    episodeIds: string[],
    lifecycleState: import("@neurocore/protocol").MemoryLifecycleState
  ): ProceduralSkillSpec[] {
    const touched = this.listSkills(tenantId).filter((skill) =>
      this.readSkillSourceEpisodeIds(skill).some((episodeId) => episodeIds.includes(episodeId))
    );
    for (const skill of touched) {
      const nextMetadata = {
        ...(skill.metadata ?? {}),
        memory_lifecycle_state: lifecycleState
      };
      this.store.save({
        ...structuredClone(skill),
        metadata: nextMetadata
      });
    }
    return touched.map((skill) => ({
      ...this.toSkillSpec(tenantId, skill),
      lifecycle_state: structuredClone(lifecycleState)
    }));
  }

  public evaluateSkills(
    tenantId: string,
    rewardsBySkillId: (skillId: string) => import("@neurocore/protocol").RewardSignal[],
    profile: import("@neurocore/protocol").AgentProfile,
    now: string
  ): SkillEvaluation[] {
    if (!this.skillEvaluator || profile.rl_config?.enabled === false) {
      return [];
    }

    const evaluations: SkillEvaluation[] = [];
    const prunedSkills: SkillDefinition[] = [];
    for (const skill of this.store.list(tenantId)) {
      const evaluation = this.skillEvaluator.evaluate({
        tenant_id: tenantId,
        skill,
        rewards: rewardsBySkillId(skill.skill_id),
        policyState: this.skillPolicy?.getState(tenantId, skill.skill_id),
        now,
        config: profile.rl_config
      });
      evaluations.push(evaluation);

      const nextSkill: SkillDefinition = {
        ...structuredClone(skill),
        status: evaluation.status
      };
      this.store.save(nextSkill);

      const pruneTtlMs = profile.rl_config?.evaluation?.prune_ttl_ms;
      const lastSelectedAt = this.skillPolicy?.getState(tenantId, skill.skill_id)?.last_selected_at;
      const ttlExpired =
        pruneTtlMs !== undefined &&
        Date.parse(now) - Date.parse(lastSelectedAt ?? readTimestamp(skill.metadata?.compiled_at) ?? now) >= pruneTtlMs;
      const shouldPrune =
        ttlExpired || evaluation.status === "pruned";
      if (shouldPrune) {
        if (profile.rl_config?.evaluation?.prune_mode === "hard") {
          this.store.delete(skill.skill_id);
        } else {
          this.store.save({
            ...nextSkill,
            status: "pruned"
          });
        }
        prunedSkills.push({
          ...nextSkill,
          status: "pruned"
        });
      }
    }

    this.lastEvaluations = evaluations;
    this.lastPrunedSkills = prunedSkills;
    return evaluations;
  }

  public reconcileTransferredSkillOutcome(
    tenantId: string,
    skillId: string,
    outcome: Episode["outcome"]
  ): SkillDefinition | null {
    const skill = this.store.get(skillId);
    if (!skill) {
      return null;
    }

    const metadata =
      skill.metadata && typeof skill.metadata === "object"
        ? (skill.metadata as Record<string, unknown>)
        : undefined;
    const sourceSkillId =
      typeof metadata?.transferred_from_skill_id === "string"
        ? metadata.transferred_from_skill_id
        : undefined;
    if (!sourceSkillId) {
      return null;
    }

    if (outcome !== "success") {
      this.store.delete(skillId);
      return {
        ...structuredClone(skill),
        status: "pruned"
      };
    }

    const validationRemaining = readNumber(metadata?.validation_remaining_uses);
    if (validationRemaining === undefined) {
      return null;
    }

    const nextMetadata = { ...(metadata ?? {}) };
    if (validationRemaining > 1) {
      nextMetadata.validation_remaining_uses = validationRemaining - 1;
    } else {
      delete nextMetadata.validation_remaining_uses;
      delete nextMetadata.confidence_penalty;
      nextMetadata.transfer_validated_at = nowIso();
    }

    const updatedSkill: SkillDefinition = {
      ...structuredClone(skill),
      metadata: nextMetadata
    };
    this.store.save(updatedSkill);
    return updatedSkill;
  }

  private buildTriggerContext(ctx: ModuleContext): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const currentInput = ctx.runtime_state.current_input_content;
    if (typeof currentInput === "string") {
      result.input_content = currentInput;
    }

    const inputMetadata =
      ctx.runtime_state.current_input_metadata &&
      typeof ctx.runtime_state.current_input_metadata === "object"
        ? (ctx.runtime_state.current_input_metadata as Record<string, unknown>)
        : undefined;

    if (typeof inputMetadata?.sourceToolName === "string") {
      result.tool_name = inputMetadata.sourceToolName;
    } else if (typeof inputMetadata?.tool_name === "string") {
      result.tool_name = inputMetadata.tool_name;
    } else if (typeof ctx.runtime_state.tool_name === "string") {
      result.tool_name = ctx.runtime_state.tool_name;
    }

    if (typeof inputMetadata?.sourceActionType === "string") {
      result.action_type = inputMetadata.sourceActionType;
    } else if (typeof inputMetadata?.action_type === "string") {
      result.action_type = inputMetadata.action_type;
    } else if (typeof ctx.runtime_state.action_type === "string") {
      result.action_type = ctx.runtime_state.action_type;
    }

    for (const goal of ctx.goals) {
      if (goal.status === "active") {
        result.goal_title = goal.title;
        result.goal_type = goal.goal_type;
        break;
      }
    }

    const skillProposals = ctx.runtime_state.skill_match_proposals;
    if (Array.isArray(skillProposals)) {
      for (const proposal of skillProposals) {
        const payload = (proposal as { payload?: Record<string, unknown> }).payload;
        if (payload?.tool_name && result.tool_name === undefined) {
          result.tool_name = payload.tool_name;
        }
        if (payload?.action_type && result.action_type === undefined) {
          result.action_type = payload.action_type;
        }
      }
    }

    return result;
  }

  private addEpisodeToSession(sessionId: string, episode: Episode): void {
    const current = this.episodesBySession.get(sessionId) ?? [];
    if (!current.some((candidate) => candidate.episode_id === episode.episode_id)) {
      current.push(episode);
      this.episodesBySession.set(sessionId, current);
    }
  }

  private addEpisodeToPatternGroup(tenantId: string, episode: Episode): TenantEpisodeGroup {
    const patternKey = derivePatternKey(episode);
    const groupKey = `${tenantId}:${patternKey}`;
    const group = this.episodesByTenantPattern.get(groupKey) ?? {
      tenantId,
      episodes: []
    };

    if (!group.episodes.some((candidate) => candidate.episode_id === episode.episode_id)) {
      group.episodes.push(episode);
      this.episodesByTenantPattern.set(groupKey, group);
    }

    return group;
  }

  private removeSessionEpisodes(sessionId: string): Set<string> {
    const tenantId = this.tenantBySession.get(sessionId);
    const episodes = this.episodesBySession.get(sessionId) ?? [];
    const affectedPatternKeys = new Set<string>();

    if (!tenantId || episodes.length === 0) {
      this.episodesBySession.delete(sessionId);
      return affectedPatternKeys;
    }

    for (const episode of episodes) {
      const patternKey = derivePatternKey(episode);
      affectedPatternKeys.add(patternKey);
      const groupKey = `${tenantId}:${patternKey}`;
      const group = this.episodesByTenantPattern.get(groupKey);
      if (!group) {
        continue;
      }

      group.episodes = group.episodes.filter(
        (candidate) => candidate.episode_id !== episode.episode_id
      );

      if (group.episodes.length === 0) {
        this.episodesByTenantPattern.delete(groupKey);
      } else {
        this.episodesByTenantPattern.set(groupKey, group);
      }
    }

    this.episodesBySession.delete(sessionId);
    return affectedPatternKeys;
  }

  private reconcilePatternSkill(
    tenantId: string,
    patternKey: string,
    generateSkillId: (prefix: string) => string = generateId,
    now: () => string = nowIso,
    applicableDomains?: string[]
  ): SkillDefinition | null {
    const groupKey = `${tenantId}:${patternKey}`;
    const group = this.episodesByTenantPattern.get(groupKey);
    const episodes = (group?.episodes ?? []).filter(
      (episode) => episode.outcome === "success" && derivePatternKey(episode) === patternKey
    );
    const existing = this.listPatternSkills(tenantId, patternKey);

    if (!shouldPromoteToSkill(episodes, patternKey, this.promotionThreshold)) {
      for (const skill of existing) {
        this.store.delete(skill.skill_id);
      }
      return null;
    }

    if (existing.length === 0) {
      const compiled = compileSkillFromEpisodes(
        episodes,
        patternKey,
        tenantId,
        generateSkillId,
        now,
        applicableDomains
      );
      this.store.save(compiled);
      return compiled;
    }

    const [primary, ...duplicates] = existing;
    const refreshed = {
      ...compileSkillFromEpisodes(episodes, patternKey, tenantId, () => primary.skill_id, now, primary.applicable_domains),
      skill_id: primary.skill_id,
      version: primary.version
    };
    this.store.save(refreshed);
    for (const skill of duplicates) {
      this.store.delete(skill.skill_id);
    }
    return null;
  }

  private listPatternSkills(tenantId: string, patternKey: string): SkillDefinition[] {
    return this.store.list(tenantId).filter((skill) => {
      return this.readSkillMetadata(skill).patternKey === patternKey;
    });
  }

  private toSkillSpec(tenantId: string, skill: SkillDefinition): ProceduralSkillSpec {
    const metadata =
      skill.metadata && typeof skill.metadata === "object"
        ? (skill.metadata as Record<string, unknown>)
        : undefined;
    const lifecycleState =
      metadata?.memory_lifecycle_state &&
      typeof metadata.memory_lifecycle_state === "object" &&
      !Array.isArray(metadata.memory_lifecycle_state)
        ? structuredClone(metadata.memory_lifecycle_state as import("@neurocore/protocol").MemoryLifecycleState)
        : undefined;
    return {
      spec_id: `spec_${skill.skill_id}`,
      schema_version: skill.schema_version,
      tenant_id: tenantId,
      skill_id: skill.skill_id,
      name: skill.name,
      version: skill.version,
      summary: skill.description,
      trigger_conditions: structuredClone(skill.trigger_conditions),
      execution_template: structuredClone(skill.execution_template),
      source_episode_ids: this.readSkillSourceEpisodeIds(skill),
      applicable_domains: skill.applicable_domains ? [...skill.applicable_domains] : undefined,
      risk_level: skill.risk_level,
      lifecycle_state: lifecycleState ?? {
        status:
          skill.status === "deprecated"
            ? "suspect"
            : skill.status === "pruned"
              ? "tombstoned"
              : "active",
        marked_at: nowIso()
      },
      parametric_unit_refs: Array.isArray(metadata?.parametric_unit_refs)
        ? structuredClone(metadata.parametric_unit_refs as import("@neurocore/protocol").ParametricUnitRef[])
        : undefined,
      metadata: skill.metadata && typeof skill.metadata === "object"
        ? structuredClone(skill.metadata as Record<string, import("@neurocore/protocol").JsonValue | undefined>)
        : undefined,
      created_at: nowIso(),
      updated_at: nowIso()
    };
  }

  private readSkillMetadata(skill: SkillDefinition): { tenantId?: string; patternKey?: string } {
    const metadata =
      skill.metadata && typeof skill.metadata === "object"
        ? (skill.metadata as Record<string, unknown>)
        : undefined;

    return {
      tenantId: typeof metadata?.tenant_id === "string" ? metadata.tenant_id : undefined,
      patternKey: typeof metadata?.pattern_key === "string" ? metadata.pattern_key : undefined
    };
  }

  private readSkillSourceEpisodeIds(skill: SkillDefinition): string[] {
    const metadata =
      skill.metadata && typeof skill.metadata === "object"
        ? (skill.metadata as Record<string, unknown>)
        : undefined;
    if (!Array.isArray(metadata?.source_episode_ids)) {
      return [];
    }

    return metadata.source_episode_ids.filter(
      (episodeId): episodeId is string => typeof episodeId === "string"
    );
  }

  private getTriggerConditionValue(
    skill: SkillDefinition,
    field: string
  ): string | number | boolean | undefined {
    const condition = skill.trigger_conditions.find(
      (candidate) => candidate.field === field && candidate.operator === "eq"
    );
    return condition?.value;
  }

  private resolveCandidateSkills(
    ctx: ModuleContext,
    triggerContext: Record<string, unknown>
  ): SkillDefinition[] {
    const matched = this.store.findByTrigger(ctx.tenant_id, triggerContext);
    const currentDomain = ctx.profile.domain?.trim().toLowerCase();

    if (!currentDomain || ctx.profile.rl_config?.transfer?.enabled !== true || !this.transferEngine) {
      return matched;
    }

    const next: SkillDefinition[] = [...matched];
    for (const skill of matched) {
      const domains = skill.applicable_domains?.map((domain) => domain.toLowerCase()) ?? [];
      if (domains.length === 0 || domains.includes(currentDomain)) {
        continue;
      }

      const existingTransfer = this.findTransferredSkill(ctx.tenant_id, skill.skill_id, currentDomain);
      if (existingTransfer) {
        next.push(existingTransfer);
        continue;
      }

      const transferred = this.transferEngine.transfer({
        tenant_id: ctx.tenant_id,
        profile: ctx.profile,
        target_domain: currentDomain,
        skill
      });
      if (!transferred) {
        continue;
      }

      this.store.save(transferred.skill);
      this.lastTransferredSkill = transferred.skill;
      this.lastTransferResult = transferred.result;
      next.push(transferred.skill);
    }

    return dedupeSkills(next);
  }

  private findTransferredSkill(
    tenantId: string,
    sourceSkillId: string,
    targetDomain: string
  ): SkillDefinition | null {
    const duplicates = this.store.list(tenantId).filter((skill) => {
      const metadata =
        skill.metadata && typeof skill.metadata === "object"
          ? (skill.metadata as Record<string, unknown>)
          : undefined;
      return (
        typeof metadata?.transferred_from_skill_id === "string" &&
        metadata.transferred_from_skill_id === sourceSkillId &&
        typeof metadata?.target_domain === "string" &&
        metadata.target_domain === targetDomain
      );
    });

    const [primary, ...rest] = duplicates;
    for (const duplicate of rest) {
      this.store.delete(duplicate.skill_id);
    }
    return primary ?? null;
  }

  private toSkillCandidate(
    ctx: ModuleContext,
    cycleId: string,
    skill: SkillDefinition
  ): SkillCandidate {
    const state = this.skillPolicy?.getState(ctx.tenant_id, skill.skill_id);
    const metadata =
      skill.metadata && typeof skill.metadata === "object"
        ? (skill.metadata as Record<string, unknown>)
        : undefined;
    return {
      tenant_id: ctx.tenant_id,
      session_id: ctx.session.session_id,
      cycle_id: cycleId,
      skill_id: skill.skill_id,
      skill_name: skill.name,
      skill_version: skill.version,
      risk_level: skill.risk_level,
      applicable_domains: skill.applicable_domains,
      trigger_score: 1,
      q_value: state?.q_value ?? (ctx.profile.rl_config?.policy?.default_q_value ?? 0.5),
      sample_count: state?.sample_count ?? 0,
      success_rate:
        state && state.sample_count > 0
          ? state.success_count / state.sample_count
          : 0,
      average_reward: state?.average_reward ?? 0,
      confidence_penalty: readNumber(metadata?.confidence_penalty),
      validation_remaining_uses: readNumber(metadata?.validation_remaining_uses)
    };
  }
}

function dedupeSkills(skills: SkillDefinition[]): SkillDefinition[] {
  const next = new Map<string, SkillDefinition>();
  for (const skill of skills) {
    next.set(skill.skill_id, skill);
  }
  return [...next.values()];
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTimestamp(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
