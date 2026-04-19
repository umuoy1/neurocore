import type {
  ActionExecution,
  AgentProfile,
  AgentSession,
  AskUserPromptSchema,
  BudgetAssessment,
  CandidateAction,
  SessionCheckpoint,
  Episode,
  FastMetaAssessment,
  Goal,
  JsonSchema,
  JsonValue,
  CycleTrace,
  CycleTraceRecord,
  MemoryConfig,
  MemoryDigest,
  CalibrationBucketStats,
  CalibrationRecord,
  MetaAssessment,
  MetaSignalProviderProfile,
  MetaSignalProviderReliabilityRecord,
  MetaDecisionV2,
  MetaDecision,
  ReflectionRule,
  MetaTriggerTag,
  Observation,
  PolicyDecision,
  Prediction,
  PredictionError,
  Proposal,
  RuntimeSessionSnapshot,
  SkillDefinition,
  ToolExecutionPolicy,
  VerifierMode,
  VerifierResult,
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
  memory_config?: MemoryConfig;
}

export interface Reasoner {
  name: string;
  plan(ctx: ModuleContext): Promise<Proposal[]>;
  respond(ctx: ModuleContext): Promise<CandidateAction[]>;
  streamText(ctx: ModuleContext, action: CandidateAction): AsyncIterable<string>;
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
  evaluateInput?(ctx: ModuleContext, input: import("./types.js").UserInput | import("./types.js").SystemInput): Promise<PolicyDecision[]>;
  evaluateAction(ctx: ModuleContext, action: CandidateAction): Promise<PolicyDecision[]>;
  evaluateOutput?(ctx: ModuleContext, output: {
    action: CandidateAction;
    text: string;
    ask_user_schema?: AskUserPromptSchema;
  }): Promise<PolicyDecision[]>;
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
  mime_type?: string;
  content_parts?: import("./types.js").ContentPart[];
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
    policies: PolicyDecision[],
    predictionErrorRate?: number
  ): Promise<MetaDecision>;
}

export interface ControlAllocator {
  decide(input: {
    ctx: ModuleContext;
    actions: CandidateAction[];
    predictions: Prediction[];
    policies: PolicyDecision[];
    workspace: WorkspaceSnapshot;
    budgetAssessment?: BudgetAssessment;
    fastAssessment: FastMetaAssessment;
    metaAssessment: MetaAssessment;
    predictionErrorRate?: number;
  }): Promise<MetaDecisionV2>;
}

export interface CalibrationStore {
  append(record: CalibrationRecord): void;
  list(sessionId?: string): CalibrationRecord[];
  listByTaskBucket(taskBucket: string): CalibrationRecord[];
  getBucketStats(input: {
    taskBucket: string;
    riskLevel?: string;
    predictorId?: string;
  }): CalibrationBucketStats;
  deleteSession(sessionId: string): void;
  close?(): void;
}

export interface MetaSignalProviderReliabilityStore {
  append(record: MetaSignalProviderReliabilityRecord): void;
  list(sessionId?: string): MetaSignalProviderReliabilityRecord[];
  listByProvider(provider: string, family?: string): MetaSignalProviderReliabilityRecord[];
  getProfile(input: {
    provider: string;
    family: string;
  }): MetaSignalProviderProfile;
  deleteSession(sessionId: string): void;
  close?(): void;
}

export interface ReflectionStore {
  save(rule: ReflectionRule): void;
  list(sessionId?: string): ReflectionRule[];
  findByTaskBucket(taskBucket: string, riskLevel?: string): ReflectionRule[];
  deleteSession(sessionId: string): void;
  close?(): void;
}

export interface VerifierInput {
  ctx: ModuleContext;
  workspace: WorkspaceSnapshot;
  frame: import("./types.js").MetaSignalFrame;
  fastAssessment: FastMetaAssessment;
  actions: CandidateAction[];
  predictions: Prediction[];
  policies: PolicyDecision[];
  triggerTags: MetaTriggerTag[];
}

export interface Verifier {
  name: string;
  mode: VerifierMode;
  timeoutMs?: number;
  shouldRun?(input: VerifierInput): boolean;
  verify(input: VerifierInput): Promise<VerifierResult>;
}

export interface CounterfactualSimulator {
  name: string;
  timeoutMs?: number;
  shouldRun?(input: VerifierInput): boolean;
  simulate(input: VerifierInput): Promise<VerifierResult | null>;
}

export interface PredictionStore {
  recordPrediction(prediction: Prediction): void;
  recordError(error: PredictionError): void;
  listErrors(sessionId: string): PredictionError[];
  getErrorsByAction(sessionId: string, actionId: string): PredictionError[];
  getRecentErrorRate(sessionId: string, windowSize: number): number;
  deleteSession?(sessionId: string): void;
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

export interface SkillStore {
  save(skill: SkillDefinition): void;
  get(skillId: string): SkillDefinition | undefined;
  list(tenantId: string): SkillDefinition[];
  findByTrigger(tenantId: string, context: Record<string, unknown>): SkillDefinition[];
  delete(skillId: string): void;
  deleteByTenant?(tenantId: string): void;
}

export interface TokenEstimator {
  estimate(text: string): number;
}

export interface CompressResult {
  snapshot: WorkspaceSnapshot;
  proposals: Proposal[];
  tokensSaved: number;
  stagesApplied: string[];
}

export interface ContextCompressor {
  compress(
    snapshot: WorkspaceSnapshot,
    proposals: Proposal[],
    tokenBudget: number,
    estimator: TokenEstimator
  ): CompressResult;
}
