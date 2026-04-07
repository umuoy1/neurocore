import type {
  ActionExecution,
  CandidateAction,
  Episode,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  ProceduralMemorySnapshot,
  Proposal,
  SkillDefinition,
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

  private readonly store: SkillStore;
  private readonly promotionThreshold: number;
  private readonly tenantBySession = new Map<string, string>();
  private readonly episodesBySession = new Map<string, Episode[]>();
  private readonly episodesByTenantPattern = new Map<string, TenantEpisodeGroup>();
  private lastPromotedSkill: SkillDefinition | null = null;

  public constructor(store?: SkillStore, promotionThreshold = 3) {
    this.store = store ?? new InMemorySkillStore();
    this.promotionThreshold = promotionThreshold;
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

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    if (ctx.profile.memory_config.procedural_memory_enabled === false) {
      return [];
    }

    const triggerContext = this.buildTriggerContext(ctx);
    const skills = this.store.findByTrigger(ctx.tenant_id, triggerContext);
    if (skills.length === 0) return [];

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
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
      ctx.services.now.bind(ctx.services)
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

    return { skills };
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
    now: () => string = nowIso
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
        now
      );
      this.store.save(compiled);
      return compiled;
    }

    const [primary, ...duplicates] = existing;
    const refreshed = {
      ...compileSkillFromEpisodes(episodes, patternKey, tenantId, () => primary.skill_id, now),
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
}
