import type {
  ActionExecution,
  CandidateAction,
  Episode,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
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

interface TenantEpisodeGroup {
  tenantId: string;
  episodes: Episode[];
}

export class ProceduralMemoryProvider implements MemoryProvider, SkillProvider {
  public readonly name = "procedural-memory-provider";

  private readonly store: SkillStore;
  private readonly promotionThreshold: number;
  private readonly tenantBySession = new Map<string, string>();
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
        name: skill.name,
        kind: skill.kind,
        version: skill.version,
        execution_template: skill.execution_template,
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

    this.tenantBySession.set(ctx.session.session_id, ctx.tenant_id);
    this.lastPromotedSkill = null;

    if (episode.outcome !== "success") return;

    const patternKey = derivePatternKey(episode);
    const groupKey = `${ctx.tenant_id}:${patternKey}`;

    const group = this.episodesByTenantPattern.get(groupKey) ?? {
      tenantId: ctx.tenant_id,
      episodes: []
    };

    if (!group.episodes.some((ep) => ep.episode_id === episode.episode_id)) {
      group.episodes.push(episode);
      this.episodesByTenantPattern.set(groupKey, group);
    }

    if (!shouldPromoteToSkill(group.episodes, patternKey, this.promotionThreshold)) {
      return;
    }

    const existingSkills = this.store.list(ctx.tenant_id);
    const alreadyCompiled = existingSkills.some(
      (skill) => skill.metadata?.pattern_key === patternKey
    );
    if (alreadyCompiled) return;

    const compiled = compileSkillFromEpisodes(
      group.episodes,
      patternKey,
      ctx.tenant_id,
      ctx.services.generateId.bind(ctx.services),
      ctx.services.now.bind(ctx.services)
    );
    this.store.save(compiled);
    this.lastPromotedSkill = compiled;
  }

  public async match(ctx: ModuleContext): Promise<Proposal[]> {
    return this.retrieve(ctx);
  }

  public async execute(
    ctx: ModuleContext,
    skillId: string,
    action: CandidateAction
  ): Promise<ActionExecution | null> {
    const skill = this.store.get(skillId);
    if (!skill) return null;

    if (skill.kind === "toolchain_skill") {
      const timestamp = ctx.services.now();
      const execution: ActionExecution = {
        execution_id: ctx.services.generateId("exe"),
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        action_id: action.action_id,
        status: "succeeded",
        started_at: timestamp,
        ended_at: timestamp,
        executor: "runtime"
      };
      return execution;
    }

    return null;
  }

  public deleteSession(sessionId: string): void {
    this.tenantBySession.delete(sessionId);
  }

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.tenantBySession.set(sessionId, tenantId);
    for (const episode of episodes) {
      if (episode.outcome !== "success") continue;
      const patternKey = derivePatternKey(episode);
      const groupKey = `${tenantId}:${patternKey}`;
      const group = this.episodesByTenantPattern.get(groupKey) ?? {
        tenantId,
        episodes: []
      };
      if (!group.episodes.some((ep) => ep.episode_id === episode.episode_id)) {
        group.episodes.push(episode);
        this.episodesByTenantPattern.set(groupKey, group);
      }
    }
  }

  private buildTriggerContext(ctx: ModuleContext): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const currentInput = ctx.runtime_state.current_input_content;
    if (typeof currentInput === "string") {
      result.input_content = currentInput;
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
        if (payload?.tool_name) {
          result.tool_name = payload.tool_name;
        }
        if (payload?.action_type) {
          result.action_type = payload.action_type;
        }
      }
    }

    return result;
  }
}
