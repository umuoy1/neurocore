import type {
  AutonomyContinualLearner,
  AutonomyState,
  KnowledgeSnapshot,
  ModuleContext
} from "@neurocore/protocol";
import { InMemoryKnowledgeStore } from "./in-memory-knowledge-store.js";

export class DefaultContinualLearner implements AutonomyContinualLearner {
  public readonly name = "default-continual-learner";

  public constructor(
    private readonly knowledgeStore: InMemoryKnowledgeStore = new InMemoryKnowledgeStore()
  ) {}

  public async consolidate(ctx: ModuleContext, state: AutonomyState): Promise<KnowledgeSnapshot | null> {
    const summary = state.active_plan
      ? `Consolidate outcomes for ${state.active_plan.title}.`
      : "Consolidate recent autonomous experience.";
    const snapshot: KnowledgeSnapshot = {
      snapshot_id: ctx.services.generateId("kns"),
      session_id: ctx.session.session_id,
      summary,
      skill_count: ctx.profile.skill_refs.length,
      rule_count: 0,
      memory_count: 0,
      created_at: ctx.services.now()
    };
    this.knowledgeStore.append(snapshot);
    return snapshot;
  }

  public list(sessionId: string): KnowledgeSnapshot[] {
    return this.knowledgeStore.list(sessionId);
  }

  public deleteSession(sessionId: string): void {
    this.knowledgeStore.deleteSession(sessionId);
  }
}
