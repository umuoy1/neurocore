# NeuroCore Execution Roadmap

## Milestone 5: Cognitive Core

- [in_progress] Goal tree execution
  - [x] Support reasoner-driven goal decomposition
  - [x] Persist parent/child goal hierarchy in runtime snapshots and checkpoints
  - [x] Track derived parent status from child goals
  - [x] Expose local goal inspection on session handles
  - [ ] Enforce goal dependency ordering in GoalManager.isActionable
  - [ ] Add created_at/updated_at lifecycle timestamps to Goal type
- [pending] Predictor and skill integration
  - [x] Add builder/runtime registration for predictors
  - [x] Add builder/runtime registration for skill providers
  - [x] Include predictor and skill outputs in workspace selection flow
- [pending] Long-term memory
  - [x] Add cross-session memory retrieval
  - [x] Introduce semantic or procedural memory implementation
  - [x] Add consolidation flow for episodic to long-term memory
  - [ ] Add configurable retrieval limits (replace hardcoded slice(-5)/slice(-3))
  - [ ] Add bounded working memory with TTL and eviction policy
  - [ ] Store failure episodes in semantic memory for negative-pattern learning
  - [ ] Add tenant isolation for shared episodic/semantic memory stores
- [in_progress] Policy and budget upgrades
  - [x] Support custom policy provider registration
  - [x] Replace heuristic budget checks with token/cost/tool quotas
  - [x] Add configurable tool allow/deny policy bundles
  - [ ] Expand approval policy by tenant and risk level
  - [ ] Enforce budget limits in cycle engine (block execution when exceeded)
  - [ ] Add token counting and cost budget tracking
  - [ ] Add per-tenant and per-tool rate limiting

## Milestone 6: Hosted Runtime

- [done] Async and stream runtime modes
  - [x] Implement background session execution for `async`
  - [x] Implement server-side streaming or SSE for `stream`
  - [x] Add remote client support for async and stream session flows
- [done] Runtime event delivery
  - [x] Emit runtime events from the execution path
  - [x] Add event subscription transport
  - [x] Support webhook delivery for hosted workflows
- [done] Durable state backend
  - [x] Add a database-backed `RuntimeStateStore`
  - [x] Add concurrency protection for resume and approval paths
  - [x] Add lifecycle cleanup for terminal sessions and checkpoints
- [done] Remote eval API
  - [x] Expose eval run creation on `runtime-server`
  - [x] Persist eval reports and replay references
  - [x] Add remote client bindings for eval APIs

## Milestone 7: Productization

- [in_progress] Automated testing and CI
  - [x] Add unit and integration test suites
  - [x] Add CI for build, typecheck, and regression demos
  - [ ] Add release/version workflow
- [pending] Governance and tenancy
  - [ ] Add authentication for runtime-server
  - [ ] Add tenant isolation and permission checks
  - [ ] Add approval audit identity and reviewer policy
- [pending] Observability
  - [ ] Add structured logs and metrics export
  - [ ] Add trace export beyond local debug logging
  - [ ] Add runtime health and saturation reporting
- [pending] Control plane UX
  - [ ] Add session and approval inspection UI or admin API layer
  - [ ] Add trace/workspace/replay browsing workflow
  - [ ] Add eval report browsing and comparison tooling

## Milestone 8: Runtime Hardening

- [pending] Provider isolation and resilience
  - [ ] Wrap individual provider calls in try/catch within Promise.all (cycle-engine)
  - [ ] Add configurable timeout for reasoner plan/respond calls
  - [ ] Add configurable timeout for memory/skill/policy provider calls
  - [ ] Add circuit breaker for consistently failing tools
- [pending] Execution correctness
  - [ ] Error on unknown selected_action_id instead of silent fallback to actions[0]
  - [ ] Add session-level concurrency guard in SessionManager (compare-and-swap or lock)
  - [ ] Validate tool_args against tool.inputSchema before invoking
  - [ ] Distinguish transient vs permanent errors in tool retry logic
  - [ ] Add exponential backoff with jitter for tool retries
  - [ ] Add error handling around RuntimeStateStore persistence operations
- [pending] MetaController improvements
  - [ ] Rank candidate actions by confidence/salience/risk instead of picking first
  - [ ] Make approval threshold configurable (replace hardcoded 0.7)
  - [ ] Compute meaningful confidence scores (replace hardcoded 0.6)
  - [ ] Include risk_summary in approval decisions for reviewer context
- [pending] Session lifecycle
  - [ ] Add session TTL with automatic expiration and idle detection
  - [ ] Add last_active_at tracking for idle session detection
  - [ ] Add in-memory session eviction (LRU or max count) in SessionManager
  - [ ] Prevent hydrate from silently overwriting existing sessions

## Milestone 9: Core Feature Gaps

- [pending] Multi-turn conversation
  - [ ] Add conversation history buffer with role-annotated messages (user/assistant/system)
  - [ ] Add sliding window or token-aware context truncation strategy
  - [ ] Add context summarization for long conversations
  - [ ] Add token counting for workspace snapshots before sending to reasoner
- [pending] Parallel tool execution
  - [ ] Allow reasoner to propose multiple concurrent tool calls per cycle
  - [ ] Implement fork/join execution with barrier for parallel tool results
  - [ ] Honor allow_parallel_modules and allow_async_tools config flags
- [pending] Agent delegation
  - [ ] Implement delegate action type with sub-agent resolution by ID
  - [ ] Spawn child sessions for delegated work with context/goal forwarding
  - [ ] Propagate child agent results back to parent session
  - [ ] Support shared runtime across sessions from the same AgentBuilder
- [pending] Conditional planning
  - [ ] Support branching/fallback chains in CandidateAction (if A fails, try B)
  - [ ] Evaluate CandidateAction.preconditions before execution
  - [ ] Add DAG-based plan structure beyond flat action lists
- [pending] Tool result caching
  - [ ] Implement cache layer in ToolGateway keyed by idempotency_key
  - [ ] Add configurable cache TTL and invalidation policy
- [pending] Structured user interaction
  - [ ] Extend ask_user with structured prompt schema (options, forms, date pickers)
  - [ ] Add input validation for structured user responses
- [pending] Multi-modal input
  - [ ] Extend UserInput.content to support typed content parts (text, image, file)
  - [ ] Add MIME type handling for tool results and observations
- [pending] Content filtering
  - [ ] Add input content screening before reasoner invocation
  - [ ] Add output content filtering before response delivery
  - [ ] Add evaluateInput/evaluateOutput to PolicyProvider interface
- [pending] Token-level streaming
  - [ ] Add AsyncIterable variant for Reasoner plan/respond
  - [ ] Implement incremental content delivery for stream session mode
  - [ ] Differentiate stream mode from async mode in runtime server

## Milestone 10: Operational Maturity

- [pending] Webhook reliability
  - [ ] Add retry with exponential backoff on webhook delivery failure
  - [ ] Add dead letter queue for permanently failed deliveries
  - [ ] Add webhook signature (HMAC) for recipient verification
  - [ ] Add delivery timeout configuration
- [pending] Batch and bulk operations
  - [ ] Add concurrent eval case execution with configurable parallelism
  - [ ] Add batch session creation API on runtime-server
- [pending] Agent versioning
  - [ ] Support multiple versions of the same agent in the registry
  - [ ] Add version routing and compatibility validation on session resume
- [pending] Session sharing
  - [ ] Add role-based session access (viewer/contributor/approver)
  - [ ] Add concurrent input conflict resolution beyond mutex rejection
- [pending] Pluggable observability
  - [ ] Add pluggable logger interface to replace hardcoded debugLog
  - [ ] Add metrics collection interface for latency/token/cost export
  - [ ] Add OpenTelemetry span creation for distributed tracing
  - [ ] Honor ObservabilityConfig.trace_enabled and event_stream_enabled flags

## Milestone 11: SDK Robustness

- [pending] Agent builder validation
  - [ ] Validate agent ID format (reject empty, whitespace, special characters)
  - [ ] Detect and reject duplicate tool/provider/predictor registration
  - [ ] Sync configurePolicy with profile.policies.policy_ids
  - [ ] Add build() method returning a reusable Agent instance with shared runtime
  - [ ] Add validate() method for pre-flight configuration checks
- [pending] Session handle improvements
  - [ ] Use high-resolution IDs for runText/resumeText (replace Date.now() with generateId)
  - [ ] Add getState(), isTerminal(), isRunning() convenience methods
  - [ ] Align local and remote session handle APIs (checkpoint, replay, waitForSettled)
  - [ ] Add shared ISessionHandle interface for local/remote polymorphism
  - [ ] Add event filtering (getEventsByType)
- [pending] Remote client hardening
  - [ ] Add request timeout with AbortSignal
  - [ ] Add retry logic for transient HTTP errors (429, 503)
  - [ ] Add SSE reconnection with Last-Event-ID
  - [ ] Add pagination for trace/episode/event list endpoints

## Milestone 12: Protocol Tightening

- [pending] Type safety
  - [ ] Add discriminator field to RuntimeCommand union
  - [ ] Add schema_version to SessionCheckpoint
  - [ ] Restrict CreateSessionCommand.overrides to exclude immutable fields
  - [ ] Add numeric severity ordering to PolicyDecision.level
  - [ ] Add NeuroCoreEvent discriminated union mapping event_type to payload type
- [pending] Missing protocol definitions
  - [ ] Add SuspendSessionCommand and ResumeSessionCommand
  - [ ] Add CheckpointCommand
  - [ ] Add missing event types (session.suspended, session.resumed, approval.requested, goal.completed, budget.exceeded, checkpoint.created)
  - [ ] Add event sequence number for causal ordering
