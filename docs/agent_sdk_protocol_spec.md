# NeuroCore Agent SDK 协议与 Schema 规格

## 1. 文档目标

本文档用于把前述需求、设计、架构方案收敛为统一协议规格，作为后续 SDK、Runtime、控制台、评估平台和第三方适配器的公共契约。

本规格优先回答四个问题：

1. 系统里的核心对象是什么
2. 对象之间如何流转
3. 模块之间如何交互
4. 哪些字段必须进入稳定协议层

本规格默认面向 `MVP + V1`，强调稳定性和扩展性，不追求一次性覆盖所有未来能力。

## 2. 协议分层

NeuroCore 建议采用四层协议：

### 2.1 Schema Layer

定义稳定数据结构：

- Agent Profile
- Session
- Goal
- Workspace Snapshot
- Proposal
- Action
- Observation
- Episode
- Prediction
- Trace

### 2.2 Command Layer

定义系统中的显式命令：

- 创建 Session
- 恢复 Session
- 提交输入
- 启动一个认知周期
- 执行动作
- 人工审批
- 写入记忆

### 2.3 Event Layer

定义系统中的事实事件：

- Session 已创建
- Goal 已更新
- Proposal 已提交
- Action 已执行
- Observation 已接收
- Memory 已写入

### 2.4 SPI Layer

定义运行时与模块插件之间的接口契约：

- Reasoner SPI
- Memory SPI
- Predictor SPI
- Skill SPI
- Policy SPI
- Tool SPI

## 3. 协议设计原则

### 3.1 Canonical over Convenient

协议层追求“统一和稳定”，不追求对某个 SDK 的用法最省代码。SDK 可以在协议之外提供糖衣 API，但最终都应映射到同一套 Canonical Schema。

### 3.2 Explicit State over Prompt Implicitness

凡是会影响恢复、回放、审计、评估或策略路由的内容，都必须显式进入状态模型，不能只存在于 prompt 文本里。

### 3.3 Evented over Hidden Mutation

重要状态变更必须事件化，至少要能追溯：

- 谁触发
- 在哪个 Session/Cycle 内触发
- 触发前后状态
- 影响了哪些后续决策

### 3.4 Backward-Compatible Evolution

协议演进必须遵守：

- 新字段优先采用 optional
- 旧字段废弃采用 `deprecated` 标注
- 枚举值新增要兼容旧客户端
- 同一主版本内不得删除必填字段

## 4. 标识与通用字段约定

### 4.1 标识规则

建议所有一等对象使用字符串 ID：

- `agent_id`
- `session_id`
- `goal_id`
- `cycle_id`
- `proposal_id`
- `action_id`
- `episode_id`

推荐格式：

```text
agt_xxx
ses_xxx
gol_xxx
cyc_xxx
prp_xxx
act_xxx
epi_xxx
```

### 4.2 通用元字段

所有协议对象建议带以下基础字段：

- `id`
- `schema_version`
- `tenant_id`
- `created_at`
- `updated_at`
- `source`
- `labels`
- `metadata`

说明：

- `source` 标识数据来源，如 `system`, `user`, `reasoner`, `memory`, `tool`
- `labels` 用于轻量标签过滤
- `metadata` 用于非稳定扩展字段，不应承载关键业务语义

## 5. 核心 Schema

### 5.1 AgentProfile

用途：

- 定义某类 Agent 的静态行为边界

建议结构：

```ts
type AgentProfile = {
  agent_id: string;
  schema_version: string;
  name: string;
  version: string;
  description?: string;
  role: string;
  domain?: string;
  mode: "embedded" | "runtime" | "hybrid";
  default_model?: ModelRef;
  tool_refs: string[];
  skill_refs: string[];
  policies: PolicyBundleRef;
  memory_config: MemoryConfig;
  prediction_config?: PredictionConfig;
  runtime_config: RuntimeConfig;
  observability_config?: ObservabilityConfig;
  metadata?: Record<string, unknown>;
};
```

关键字段说明：

- `tool_refs`：允许的工具集合，不等于当前周期一定可调用
- `skill_refs`：默认挂载技能集合
- `policies`：安全、预算、审批、输出约束等策略引用
- `runtime_config`：定义最大周期数、超时、默认执行模式

### 5.2 AgentSession

用途：

- 表示一次有状态运行实例

建议结构：

```ts
type AgentSession = {
  session_id: string;
  schema_version: string;
  tenant_id: string;
  agent_id: string;
  user_id?: string;
  state:
    | "created"
    | "hydrated"
    | "running"
    | "waiting"
    | "suspended"
    | "escalated"
    | "completed"
    | "failed"
    | "aborted";
  session_mode: "sync" | "async" | "stream";
  current_cycle_id?: string;
  goal_tree_ref: string;
  workspace_ref?: string;
  budget_state: BudgetState;
  policy_state: PolicyState;
  checkpoint_ref?: string;
  started_at?: string;
  ended_at?: string;
  metadata?: Record<string, unknown>;
};
```

### 5.3 Goal

用途：

- 统一描述用户目标、系统子目标、信息补足目标和恢复目标

建议结构：

```ts
type Goal = {
  goal_id: string;
  schema_version: string;
  session_id: string;
  parent_goal_id?: string;
  title: string;
  description?: string;
  goal_type:
    | "task"
    | "subtask"
    | "question"
    | "information_gap"
    | "verification"
    | "recovery";
  status:
    | "pending"
    | "active"
    | "blocked"
    | "waiting_input"
    | "completed"
    | "failed"
    | "cancelled";
  priority: number;
  importance?: number;
  urgency?: number;
  deadline_at?: string;
  dependencies?: string[];
  constraints?: Constraint[];
  acceptance_criteria?: AcceptanceCriterion[];
  progress?: number;
  owner?: "agent" | "user" | "human_reviewer" | "system";
  metadata?: Record<string, unknown>;
};
```

### 5.4 WorkspaceSnapshot

用途：

- 作为单个认知周期的统一上下文快照

建议结构：

```ts
type WorkspaceSnapshot = {
  workspace_id: string;
  schema_version: string;
  session_id: string;
  cycle_id: string;
  input_events: InputEventRef[];
  active_goals: GoalDigest[];
  context_summary: string;
  memory_digest: MemoryDigest[];
  skill_digest: SkillDigest[];
  world_state_digest?: WorldStateDigest;
  candidate_actions: CandidateAction[];
  selected_proposal_id?: string;
  risk_assessment?: RiskAssessment;
  confidence_assessment?: ConfidenceAssessment;
  budget_assessment?: BudgetAssessment;
  policy_decisions?: PolicyDecision[];
  decision_reasoning?: string;
  created_at: string;
};
```

设计要求：

- `context_summary` 不是聊天记录拷贝，而是当前阶段摘要
- `candidate_actions` 要保留未选中项，供回放和评估
- `decision_reasoning` 为人类解释服务，不要求完整暴露内部推理细节

### 5.5 Proposal

用途：

- 统一所有模块向 Workspace Coordinator 提交的候选信息或候选动作

建议结构：

```ts
type Proposal = {
  proposal_id: string;
  schema_version: string;
  session_id: string;
  cycle_id: string;
  module_name: string;
  proposal_type:
    | "context"
    | "memory_recall"
    | "skill_match"
    | "plan"
    | "prediction"
    | "risk_alert"
    | "action";
  salience_score: number;
  confidence?: number;
  risk?: number;
  estimated_cost?: number;
  estimated_latency_ms?: number;
  payload: Record<string, unknown>;
  explanation?: string;
  supersedes?: string[];
  metadata?: Record<string, unknown>;
};
```

### 5.6 CandidateAction

用途：

- 描述被系统考虑的可执行动作

建议结构：

```ts
type CandidateAction = {
  action_id: string;
  action_type:
    | "respond"
    | "ask_user"
    | "call_tool"
    | "update_goal"
    | "write_memory"
    | "delegate"
    | "wait"
    | "complete"
    | "abort";
  title: string;
  description?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  expected_outcome?: string;
  preconditions?: string[];
  side_effect_level?: "none" | "low" | "medium" | "high";
  idempotency_key?: string;
  rollback_hint?: string;
  source_proposal_id?: string;
};
```

### 5.7 ActionExecution

用途：

- 记录某个动作的正式执行信息

建议结构：

```ts
type ActionExecution = {
  execution_id: string;
  session_id: string;
  cycle_id: string;
  action_id: string;
  status: "approved" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: string;
  ended_at?: string;
  executor: "runtime" | "tool_gateway" | "human";
  approval_ref?: string;
  result_ref?: string;
  error_ref?: string;
  metrics?: {
    latency_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
};
```

### 5.8 Observation

用途：

- 统一描述动作执行后的结果输入

建议结构：

```ts
type Observation = {
  observation_id: string;
  session_id: string;
  cycle_id: string;
  source_action_id?: string;
  source_type: "tool" | "user" | "system" | "memory" | "runtime";
  status: "success" | "partial" | "failure" | "unknown";
  summary: string;
  raw_ref?: string;
  structured_payload?: Record<string, unknown>;
  side_effects?: string[];
  confidence?: number;
  created_at: string;
};
```

### 5.9 Prediction

用途：

- 统一描述行动前预测结果

建议结构：

```ts
type Prediction = {
  prediction_id: string;
  session_id: string;
  cycle_id: string;
  action_id: string;
  predictor_name: string;
  expected_outcome: string;
  success_probability?: number;
  side_effects?: string[];
  estimated_cost?: number;
  estimated_duration_ms?: number;
  required_preconditions?: string[];
  uncertainty?: number;
  reasoning?: string;
  created_at: string;
};
```

### 5.10 PredictionError

用途：

- 表示预测与真实结果之间的偏差

建议结构：

```ts
type PredictionError = {
  prediction_error_id: string;
  prediction_id: string;
  action_id: string;
  session_id: string;
  cycle_id: string;
  error_type:
    | "outcome_mismatch"
    | "cost_mismatch"
    | "duration_mismatch"
    | "side_effect_mismatch"
    | "precondition_mismatch";
  severity: "low" | "medium" | "high";
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  impact_summary?: string;
  created_at: string;
};
```

### 5.11 Episode

用途：

- 将一段可复用的经验沉淀为情景记忆

建议结构：

```ts
type Episode = {
  episode_id: string;
  schema_version: string;
  session_id: string;
  trigger_summary: string;
  goal_refs: string[];
  context_digest: string;
  selected_strategy: string;
  action_refs: string[];
  observation_refs: string[];
  outcome: "success" | "partial" | "failure";
  outcome_summary: string;
  valence?: "positive" | "neutral" | "negative";
  lessons?: string[];
  promoted_to_skill?: boolean;
  created_at: string;
};
```

### 5.12 SkillDefinition

用途：

- 定义可复用技能

建议结构：

```ts
type SkillDefinition = {
  skill_id: string;
  schema_version: string;
  name: string;
  version: string;
  kind:
    | "reasoning_skill"
    | "workflow_skill"
    | "toolchain_skill"
    | "compiled_skill";
  description?: string;
  trigger_conditions: TriggerCondition[];
  required_inputs?: InputContract[];
  execution_template: SkillExecutionTemplate;
  applicable_domains?: string[];
  risk_level?: "low" | "medium" | "high";
  fallback_policy?: FallbackPolicy;
  evaluation_metrics?: string[];
  metadata?: Record<string, unknown>;
};
```

## 6. 配置 Schema

### 6.1 RuntimeConfig

```ts
type RuntimeConfig = {
  max_cycles: number;
  max_runtime_ms?: number;
  default_sync_timeout_ms?: number;
  cycle_mode?: "fast" | "standard" | "deep";
  allow_parallel_modules?: boolean;
  allow_async_tools?: boolean;
  checkpoint_interval?: "cycle" | "action" | "manual";
};
```

### 6.2 MemoryConfig

```ts
type MemoryConfig = {
  working_memory_enabled: boolean;
  episodic_memory_enabled: boolean;
  semantic_memory_enabled?: boolean;
  procedural_memory_enabled?: boolean;
  write_policy: "immediate" | "deferred" | "hybrid";
  retrieval_top_k?: number;
  consolidation_enabled?: boolean;
};
```

### 6.3 PredictionConfig

```ts
type PredictionConfig = {
  enabled: boolean;
  required_for_side_effect_actions?: boolean;
  predictor_order?: string[];
  uncertainty_threshold?: number;
};
```

### 6.4 BudgetState

```ts
type BudgetState = {
  token_budget_total?: number;
  token_budget_used?: number;
  cost_budget_total?: number;
  cost_budget_used?: number;
  tool_call_limit?: number;
  tool_call_used?: number;
  cycle_limit?: number;
  cycle_used?: number;
};
```

### 6.5 PolicyState

```ts
type PolicyState = {
  approval_required?: boolean;
  output_restrictions?: string[];
  blocked_tools?: string[];
  escalation_level?: "none" | "review" | "approval" | "hard_stop";
  risk_mode?: "normal" | "conservative" | "strict";
};
```

## 7. 命令协议

命令表示运行时“应执行的意图”，适合通过 API、SDK、队列和内部调度器传递。

### 7.1 CreateSessionCommand

```ts
type CreateSessionCommand = {
  agent_id: string;
  tenant_id: string;
  user_id?: string;
  session_mode?: "sync" | "async" | "stream";
  initial_input: UserInput;
  overrides?: Partial<AgentProfile>;
};
```

### 7.2 SubmitInputCommand

```ts
type SubmitInputCommand = {
  session_id: string;
  input: UserInput | SystemInput;
  expect_response?: boolean;
};
```

### 7.3 StartCycleCommand

```ts
type StartCycleCommand = {
  session_id: string;
  trigger: "new_input" | "resume" | "tool_result" | "timer" | "internal";
  preferred_mode?: "fast" | "standard" | "deep";
};
```

### 7.4 ExecuteActionCommand

```ts
type ExecuteActionCommand = {
  session_id: string;
  cycle_id: string;
  action_id: string;
  approval_token?: string;
};
```

### 7.5 ApproveActionCommand

```ts
type ApproveActionCommand = {
  session_id: string;
  action_id: string;
  approver_id: string;
  decision: "approved" | "rejected";
  comment?: string;
};
```

## 8. 事件协议

事件表示已经发生的事实，是审计、回放、恢复和评估的基础。

### 8.1 通用事件头

```ts
type EventEnvelope<T> = {
  event_id: string;
  event_type: string;
  schema_version: string;
  tenant_id: string;
  session_id?: string;
  cycle_id?: string;
  timestamp: string;
  payload: T;
};
```

### 8.2 核心事件列表

- `session.created`
- `session.state_changed`
- `goal.created`
- `goal.updated`
- `cycle.started`
- `proposal.submitted`
- `workspace.committed`
- `action.selected`
- `action.approval_requested`
- `action.executed`
- `observation.recorded`
- `prediction.recorded`
- `prediction_error.recorded`
- `memory.written`
- `skill.matched`
- `skill.promoted`
- `session.completed`
- `session.failed`

### 8.3 关键事件载荷要求

`workspace.committed` 必须包含：

- 当前激活目标
- 候选 Proposal 列表
- 选中 Proposal
- 候选 Action 列表
- 预算与风险摘要

`action.executed` 必须包含：

- 执行状态
- 执行器
- 时延
- 成本
- 是否产生副作用

`memory.written` 必须包含：

- 记忆层类型
- 写入策略
- 来源对象引用
- 是否可检索

## 9. 模块 SPI

### 9.1 ModuleContext

所有模块 SPI 的输入上下文建议统一为：

```ts
type ModuleContext = {
  tenant_id: string;
  session: AgentSession;
  profile: AgentProfile;
  goals: Goal[];
  workspace?: WorkspaceSnapshot;
  runtime_state: Record<string, unknown>;
  services: RuntimeServiceLocator;
};
```

### 9.2 Reasoner SPI

```ts
interface Reasoner {
  name: string;
  plan(ctx: ModuleContext): Promise<Proposal[]>;
  respond(ctx: ModuleContext): Promise<CandidateAction[]>;
  decomposeGoal?(ctx: ModuleContext, goal: Goal): Promise<Goal[]>;
}
```

输出约束：

- 不直接执行业务动作
- 只提交 Proposal 或 CandidateAction
- 必须给出置信度或不确定性信号

### 9.3 Memory SPI

```ts
interface MemoryProvider {
  name: string;
  retrieve(ctx: ModuleContext): Promise<Proposal[]>;
  writeEpisode(ctx: ModuleContext, episode: Episode): Promise<void>;
  consolidate?(tenant_id: string): Promise<void>;
}
```

### 9.4 Predictor SPI

```ts
interface Predictor {
  name: string;
  predict(
    ctx: ModuleContext,
    action: CandidateAction
  ): Promise<Prediction | null>;
  recordError?(error: PredictionError): Promise<void>;
}
```

### 9.5 Skill SPI

```ts
interface SkillProvider {
  name: string;
  match(ctx: ModuleContext): Promise<Proposal[]>;
  execute?(
    ctx: ModuleContext,
    skillId: string,
    action: CandidateAction
  ): Promise<ActionExecution | null>;
}
```

说明：

- `SkillProvider.execute` 不应绕过 Meta Controller
- 若技能本身封装一组子动作，也应逐步记录动作执行

### 9.6 Policy SPI

```ts
interface PolicyProvider {
  name: string;
  evaluateAction(
    ctx: ModuleContext,
    action: CandidateAction
  ): Promise<PolicyDecision[]>;
}
```

### 9.7 Tool SPI

```ts
interface Tool {
  name: string;
  description?: string;
  sideEffectLevel: "none" | "low" | "medium" | "high";
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  invoke(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
```

### 9.8 Meta Controller SPI

```ts
interface MetaController {
  evaluate(
    ctx: ModuleContext,
    actions: CandidateAction[],
    predictions: Prediction[],
    policies: PolicyDecision[]
  ): Promise<MetaDecision>;
}
```

`MetaDecision` 建议至少包含：

- `selected_action_id`
- `decision_type`
- `requires_human_approval`
- `risk_summary`
- `rejection_reasons`

## 10. 决策与门控协议

### 10.1 PolicyDecision

```ts
type PolicyDecision = {
  decision_id: string;
  policy_name: string;
  level: "info" | "warn" | "block";
  target_type: "input" | "proposal" | "action" | "output";
  target_id?: string;
  reason: string;
  recommendation?: string;
};
```

### 10.2 MetaDecision

```ts
type MetaDecision = {
  decision_type:
    | "continue_internal"
    | "ask_user"
    | "execute_action"
    | "request_approval"
    | "escalate"
    | "complete"
    | "abort";
  selected_action_id?: string;
  confidence?: number;
  risk_summary?: string;
  budget_summary?: string;
  requires_human_approval?: boolean;
  rejection_reasons?: string[];
  explanation?: string;
};
```

## 11. Trace 协议

### 11.1 CycleTrace

```ts
type CycleTrace = {
  trace_id: string;
  session_id: string;
  cycle_id: string;
  started_at: string;
  ended_at?: string;
  input_refs: string[];
  proposal_refs: string[];
  prediction_refs: string[];
  policy_decision_refs: string[];
  selected_action_ref?: string;
  observation_refs: string[];
  episode_ref?: string;
  metrics?: {
    total_latency_ms?: number;
    total_tokens?: number;
    total_cost?: number;
  };
};
```

### 11.2 Replay Contract

回放系统至少需要以下输入：

- Session 快照或事件流
- Agent Profile 版本
- 技能版本
- Policy 版本
- 模型路由版本

回放输出至少包括：

- 原始决策路径
- 回放决策路径
- 差异点
- 差异原因

## 12. 对外 API 最小规格

### 12.1 Session API

- `POST /v1/agents/{agent_id}/sessions`
- `GET /v1/sessions/{session_id}`
- `POST /v1/sessions/{session_id}/inputs`
- `POST /v1/sessions/{session_id}/resume`
- `POST /v1/sessions/{session_id}/cancel`

### 12.2 Trace API

- `GET /v1/sessions/{session_id}/traces`
- `GET /v1/sessions/{session_id}/workspace/{cycle_id}`
- `GET /v1/sessions/{session_id}/episodes`

### 12.3 Approval API

- `GET /v1/approvals/{approval_id}`
- `POST /v1/approvals/{approval_id}/decision`

### 12.4 Eval API

- `POST /v1/evals/runs`
- `GET /v1/evals/runs/{run_id}`

## 13. JSON Schema 与代码生成建议

为了让 TS SDK、Python SDK、Runtime 和控制台保持一致，推荐：

1. 以 JSON Schema 或 OpenAPI 维护协议源文件
2. 自动生成：
   - TypeScript types
   - Python pydantic models
   - API client
3. 禁止手写多份独立协议定义

## 14. MVP 冻结范围

第一阶段建议冻结以下协议对象为稳定内核：

- AgentProfile
- AgentSession
- Goal
- WorkspaceSnapshot
- Proposal
- CandidateAction
- Observation
- Prediction
- PolicyDecision
- MetaDecision
- CycleTrace

以下对象允许先用轻量版本：

- Episode
- SkillDefinition
- Semantic Memory 相关结构
- 多 Agent 委托结构

## 15. 结论

NeuroCore 真正的基础设施能力，首先来自统一协议，而不是单个模型或单个运行时实现。

协议一旦稳定，后续就可以并行推进：

- TypeScript SDK
- Python SDK
- Runtime Core
- 控制台
- Trace/Replay/Eval
- 记忆、世界模型、技能等可插拔模块

这也是整个系统可维护、可扩展、可对外输出的前提。
