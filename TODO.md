# NeuroCore Execution Roadmap

> Calibrated against the current codebase on 2026-04-15.
>
> 当前最重要的变化：
> - 记忆系统已经从 fat snapshot 路径切到 SQL-first
> - Prefrontal / Meta 已经从“架构构想期”进入“元认知运行时 v1”
> - 下一阶段关键词不再是扩更多概念模块，而是：收口、闭环、持久化、SPI 化、评估化

## Milestone 5: Cognitive Core

- [done] Goal tree execution
  - [x] Support reasoner-driven goal decomposition
  - [x] Persist parent/child goal hierarchy in runtime snapshots and checkpoints
  - [x] Track derived parent status from child goals
  - [x] Expose local goal inspection on session handles
  - [x] Add created_at/updated_at lifecycle timestamps to Goal type
  - [x] Enforce goal dependency ordering in `GoalManager.isActionable`
- [done] Predictor and skill integration
  - [x] Add builder/runtime registration for predictors
  - [x] Add builder/runtime registration for skill providers
  - [x] Include predictor and skill outputs in workspace selection flow
- [done] Long-term memory v1
  - [x] Add cross-session memory retrieval
  - [x] Introduce semantic memory implementation
  - [x] Add consolidation flow for episodic to semantic memory
  - [x] Add configurable retrieval limits (`retrieval_top_k`)
  - [x] Add tenant-scoped recall for shared episodic/semantic stores
  - [x] Add working-memory max entries through agent/runtime configuration
  - [x] Add procedural memory implementation
  - [x] Move default persistence path to SQL-first
  - [ ] Add TTL-based working memory expiration
  - [ ] Store failure episodes in semantic memory for negative-pattern learning
- [in_progress] Policy and budget upgrades
  - [x] Support custom policy provider registration
  - [x] Replace heuristic budget checks with token/tool/cycle quota checks
  - [x] Add token accounting for context budget usage
  - [x] Add configurable tool allow/deny policy bundles
  - [x] Escalate warn-level/high-risk actions into approval flow
  - [ ] Expand approval policy by tenant and risk level
  - [ ] Add cost budget tracking
  - [ ] Add per-tenant and per-tool rate limiting

## Milestone 6: Hosted Runtime

- [done] Async and stream runtime modes
  - [x] Implement background session execution for `async`
  - [x] Implement server-side event streaming for `stream`
  - [x] Add remote client support for async and stream session flows
- [done] Runtime event delivery
  - [x] Emit runtime events from the execution path
  - [x] Add event subscription transport
  - [x] Support webhook delivery for hosted workflows
- [done] Durable state backend
  - [x] Add file/SQLite-backed `RuntimeStateStore`
  - [x] Add concurrency protection for hosted resume and approval paths
  - [x] Add lifecycle cleanup for terminal sessions and checkpoints
- [in_progress] Remote eval API
  - [x] Expose eval run creation on `runtime-server`
  - [x] Add report lookup endpoint on `runtime-server`
  - [x] Add remote client bindings for eval APIs
  - [ ] Persist eval reports durably across server restarts

## Milestone 7: Productization

- [in_progress] Automated testing and CI
  - [x] Add unit and integration test suites
  - [x] Add GitHub Actions CI for typecheck and test matrix
  - [x] Add changesets configuration and release scripts
  - [ ] Add automated publish/release workflow
  - [ ] Separate socket-bound hosted-runtime tests from restricted environments
  - [ ] Gate LLM baseline coverage behind explicit credentials/connectivity in CI
- [in_progress] Governance and tenancy
  - [x] Flow tenant IDs through session, trace, event, episodic, and semantic memory paths
  - [ ] Add authentication for `runtime-server`
  - [ ] Add request-time permission checks and reviewer policy
  - [ ] Add stronger approval audit identity beyond `approver_id` capture
- [in_progress] Observability
  - [x] Emit runtime events and local debug logs
  - [x] Add basic `GET /healthz`
  - [ ] Add structured logs and metrics export
  - [ ] Add trace export beyond local stores/debug logging
  - [ ] Add runtime saturation reporting
- [in_progress] Control plane UX
  - [x] Add session detail APIs
  - [x] Add trace/workspace/events/episodes lookup APIs
  - [x] Add approval decision API
  - [x] Add eval report lookup API
  - [ ] Add session/approval list and filter APIs
  - [ ] Add replay browsing and comparison APIs
  - [ ] Add admin UI layer

## Milestone 8: Runtime Hardening

- [in_progress] Provider isolation and resilience
  - [x] Isolate memory/skill/policy/predictor failures with `Promise.allSettled`
  - [ ] Add configurable timeout for reasoner `plan`/`respond` at the runtime layer
  - [ ] Add configurable timeout for memory/skill/policy provider calls
  - [ ] Add circuit breaker for consistently failing tools
- [in_progress] Execution correctness
  - [x] Validate `tool_args` against `tool.inputSchema` before invoking
  - [x] Add exponential backoff with jitter for tool retries
  - [x] Error on unknown `selected_action_id` instead of silent fallback to `actions[0]`
  - [x] Add session-level concurrency guard in `SessionManager` (CAS/lock instead of hosted wrapper only)
  - [ ] Distinguish transient vs permanent errors in tool retry logic
  - [ ] Add error handling around `RuntimeStateStore` persistence operations
- [done] Legacy MetaController improvements
  - [x] Rank candidate actions by predictor uncertainty (risk proxy)
  - [x] Make approval threshold configurable
  - [x] Compute confidence from prediction uncertainty
  - [x] Incorporate salience/conflict detection instead of picking the first viable action after risk sort
  - [x] Include `risk_summary` in approval decisions for reviewer context
- [in_progress] Session lifecycle
  - [x] Add `last_active_at` tracking
  - [x] Prevent `hydrate` from silently overwriting existing sessions
  - [ ] Add session TTL with automatic expiration and idle detection
  - [ ] Add in-memory session eviction (LRU or max count)

## Milestone 9: Core Feature Gaps

- [pending] Multi-turn conversation
  - [ ] Add conversation history buffer with role-annotated messages (user/assistant/system)
  - [ ] Add sliding window or token-aware context truncation strategy for conversation history
  - [ ] Add context summarization for long conversations
  - [ ] Add token counting before reasoner invocation for full conversational context
- [pending] Parallel tool execution
  - [ ] Allow reasoner to propose multiple concurrent tool calls per cycle
  - [ ] Implement fork/join execution with barrier for parallel tool results
  - [ ] Honor `allow_parallel_modules` and `allow_async_tools` config flags
- [pending] Agent delegation
  - [ ] Implement delegate action execution path with sub-agent resolution by ID
  - [ ] Spawn child sessions for delegated work with context/goal forwarding
  - [ ] Propagate child agent results back to parent session
  - [ ] Support shared runtime across sessions from the same built agent
- [pending] Conditional planning
  - [ ] Support branching/fallback chains in `CandidateAction`
  - [ ] Evaluate `CandidateAction.preconditions` before execution
  - [ ] Add DAG-based plan structure beyond flat action lists
- [pending] Tool result caching
  - [ ] Implement cache layer in `ToolGateway` keyed by `idempotency_key`
  - [ ] Add configurable cache TTL and invalidation policy
- [pending] Structured user interaction
  - [ ] Extend `ask_user` with structured prompt schema (options, forms, date pickers)
  - [ ] Add input validation for structured user responses
- [pending] Multi-modal input
  - [ ] Extend `UserInput` to typed content parts (text, image, file)
  - [ ] Add MIME-aware tool result and observation handling
- [pending] Content filtering
  - [ ] Add input screening before reasoner invocation
  - [ ] Add output screening before response delivery
  - [ ] Add `evaluateInput` / `evaluateOutput` to `PolicyProvider`
- [pending] Token-level streaming
  - [x] Support session-level event streaming over SSE
  - [ ] Add `AsyncIterable` token streaming for reasoner output
  - [ ] Differentiate token streaming from background `async` mode semantics

## Milestone 10: Meta Stack v2 Closure

- [done] Control plane convergence
  - [x] Add `MetaSignalBus`
  - [x] Add `FastMonitor`
  - [x] Add `DeepEvaluator`
  - [x] Add `MetaAssessment / SelfEvaluationReport / MetaControlAction`
  - [x] Decide and implement the single control source: `ControlAllocator`
  - [x] Thin `DefaultMetaController` into execution/approval adapter only
  - [x] Remove duplicated ranking/confidence/risk/approval logic from legacy control path
  - [x] Ensure all final control decisions flow through one metacognitive decision object
- [in_progress] Calibration closure
  - [x] Add `Calibrator`
  - [x] Add `InMemoryCalibrationStore`
  - [x] Record `CalibrationRecord` from execution outcome
  - [x] Unify `DeepEvaluator` and `Calibrator` confidence calibration into one path
  - [x] Add durable calibration store
  - [x] Make calibration queryable before decision time
  - [x] Add task-bucket calibration profiles
  - [ ] Add provider-level calibration profiles
- [in_progress] DeepEvaluator SPI
  - [x] Add verification trace and heuristic verifier runs
  - [x] Introduce explicit `Verifier SPI`
  - [x] Split `logic / evidence / tool / safety` verifiers
  - [x] Add optional simulator/world-model verifier integration
  - [x] Support concurrent verifier orchestration with budget-aware fallback
  - [ ] Add stricter verifier isolation policy and per-verifier budgets
- [in_progress] MetaSignalBus providerization
  - [x] Add unified signal frame with provenance
  - [x] Split signal families into provider-based collectors
  - [x] Add family-level degradation and fallback strategy
  - [x] Replace ad hoc `*-heuristic` provenance with provider-specific provenance
  - [ ] Add confidence/reliability scoring per signal provider
- [in_progress] Meta benchmark and evaluation
  - [x] Add `meta-benchmark.ts`
  - [x] Add focused tests for calibration / fast-monitor / deep-eval / control-allocator metrics
  - [ ] Add real benchmark case bundle for families A-G
  - [ ] Add online meta eval pipeline
  - [ ] Add coverage-vs-accuracy and risk-conditioned curve export
  - [ ] Add benchmark persistence and historical comparison
- [pending] Reflection and policy learning
  - [ ] Implement `ReflectionLearner`
  - [ ] Persist reflection memory / rule artifacts
  - [ ] Convert repeated failures into future control policy updates
  - [ ] Add recurrence regression suite

## Milestone 11: Operational Maturity

- [in_progress] Webhook reliability
  - [x] Add basic webhook delivery hooks
  - [ ] Add retry with exponential backoff on webhook delivery failure
  - [ ] Add dead letter queue for permanently failed deliveries
  - [ ] Add webhook signature (HMAC) for recipient verification
  - [ ] Add delivery timeout configuration
- [pending] Batch and bulk operations
  - [ ] Add concurrent eval case execution with configurable parallelism
  - [ ] Add batch session creation API on `runtime-server`
- [pending] Agent versioning
  - [ ] Support multiple versions of the same agent in the registry
  - [ ] Add version routing and compatibility validation on session resume
- [pending] Session sharing
  - [ ] Add role-based session access (viewer/contributor/approver)
  - [ ] Add concurrent input conflict resolution beyond mutex rejection
- [pending] Pluggable observability
  - [ ] Add pluggable logger interface to replace hardcoded `debugLog`
  - [ ] Add metrics collection interface for latency/token/cost export
  - [ ] Add OpenTelemetry span creation for distributed tracing
  - [ ] Honor `ObservabilityConfig.trace_enabled` and `event_stream_enabled`

## Milestone 12: SDK Robustness

- [pending] Agent builder validation
  - [ ] Validate agent ID format (reject empty, whitespace, special characters)
  - [ ] Detect and reject duplicate tool/provider/predictor registration
  - [ ] Sync `configurePolicy()` with `profile.policies.policy_ids`
  - [ ] Add `build()` method returning a reusable Agent instance with shared runtime
  - [ ] Add `validate()` method for pre-flight configuration checks
- [pending] Session handle improvements
  - [ ] Use high-resolution IDs for `runText` / `resumeText`
  - [ ] Add `getState()`, `isTerminal()`, `isRunning()` convenience methods
  - [ ] Align local and remote session handle APIs (checkpoint, replay, waitForSettled)
  - [ ] Add shared session-handle interface for local/remote polymorphism
  - [ ] Add event filtering helpers
- [pending] Remote client hardening
  - [ ] Add request timeout with `AbortSignal`
  - [ ] Add retry logic for transient HTTP errors (429, 503)
  - [ ] Add SSE reconnection with `Last-Event-ID`
  - [ ] Add pagination for trace/episode/event list endpoints

## Milestone 13: Protocol Tightening

- [pending] Type safety
  - [ ] Add discriminator field to `RuntimeCommand` union
  - [ ] Add `schema_version` to `SessionCheckpoint`
  - [ ] Restrict `CreateSessionCommand.overrides` to exclude immutable fields
  - [ ] Add numeric severity ordering to `PolicyDecision.level`
  - [ ] Add fully discriminated `NeuroCoreEvent` mapping `event_type` to payload type
- [pending] Missing protocol definitions
  - [ ] Add `SuspendSessionCommand` and `ResumeSessionCommand`
  - [ ] Add `CheckpointCommand`
  - [ ] Add missing event types (`session.suspended`, `session.resumed`, `approval.requested`, `goal.completed`, `checkpoint.created`)
  - [ ] Add event sequence numbers for causal ordering
