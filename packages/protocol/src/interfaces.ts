import type {
  ActionExecution,
  AgentProfile,
  AgentSession,
  CandidateAction,
  SessionCheckpoint,
  Episode,
  Goal,
  JsonSchema,
  JsonValue,
  CycleTrace,
  CycleTraceRecord,
  MemoryDigest,
  MetaDecision,
  Observation,
  PolicyDecision,
  Prediction,
  PredictionError,
  Proposal,
  RuntimeSessionSnapshot,
  ToolExecutionPolicy,
  WorkspaceSnapshot
} from "./types.js";

export interface RuntimeServiceLocator {
  now(): string;
  generateId(prefix: string): string;
}

export interface ModuleContext {
  tenant_id: string;
  session: AgentSession;
  profile: AgentProfile;
  goals: Goal[];
  workspace?: WorkspaceSnapshot;
  runtime_state: Record<string, unknown>;
  services: RuntimeServiceLocator;
}

export interface Reasoner {
  name: string;
  plan(ctx: ModuleContext): Promise<Proposal[]>;
  respond(ctx: ModuleContext): Promise<CandidateAction[]>;
  decomposeGoal?(ctx: ModuleContext, goal: Goal): Promise<Goal[]>;
}

export interface MemoryProvider {
  name: string;
  retrieve(ctx: ModuleContext): Promise<Proposal[]>;
  getDigest?(ctx: ModuleContext): Promise<MemoryDigest[]>;
  writeEpisode(ctx: ModuleContext, episode: Episode): Promise<void>;
  consolidate?(tenant_id: string): Promise<void>;
}

export interface Predictor {
  name: string;
  predict(ctx: ModuleContext, action: CandidateAction): Promise<Prediction | null>;
  recordError?(error: PredictionError): Promise<void>;
}

export interface SkillProvider {
  name: string;
  match(ctx: ModuleContext): Promise<Proposal[]>;
  execute?(ctx: ModuleContext, skillId: string, action: CandidateAction): Promise<ActionExecution | null>;
}

export interface PolicyProvider {
  name: string;
  evaluateAction(ctx: ModuleContext, action: CandidateAction): Promise<PolicyDecision[]>;
}

export interface ToolContext {
  tenant_id: string;
  session_id: string;
  cycle_id: string;
  attempt?: number;
  signal?: AbortSignal;
}

export interface ToolResult {
  summary: string;
  payload?: Record<string, JsonValue | undefined>;
}

export interface Tool {
  name: string;
  description?: string;
  sideEffectLevel: "none" | "low" | "medium" | "high";
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  execution?: ToolExecutionPolicy;
  invoke(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface MetaController {
  evaluate(
    ctx: ModuleContext,
    actions: CandidateAction[],
    predictions: Prediction[],
    policies: PolicyDecision[]
  ): Promise<MetaDecision>;
}

export interface TraceStore {
  append(record: CycleTraceRecord): void;
  list(sessionId: string): CycleTraceRecord[];
  getCycleRecord(sessionId: string, cycleId: string): CycleTraceRecord | undefined;
  listTraces(sessionId: string): CycleTrace[];
  replaceSession(sessionId: string, records: CycleTraceRecord[]): void;
  deleteSession?(sessionId: string): void;
}

export interface CheckpointStore {
  save(snapshot: SessionCheckpoint): void;
  get(checkpointId: string): SessionCheckpoint | undefined;
  list(sessionId: string): SessionCheckpoint[];
  deleteSession?(sessionId: string): void;
}

export interface RuntimeStateStore {
  getSession(sessionId: string): RuntimeSessionSnapshot | undefined;
  listSessions(): RuntimeSessionSnapshot[];
  saveSession(snapshot: RuntimeSessionSnapshot): void;
  deleteSession?(sessionId: string): void;
}
