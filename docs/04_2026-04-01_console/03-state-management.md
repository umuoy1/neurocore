# 状态管理

12 个 Zustand Store，每个遵循 `{ data, loading, error, fetch(), clear() }` 模式，并通过 WebSocket 事件驱动更新。

## 数据流

```
WebSocket / REST → Zustand Stores → React Components → User Actions → API / WS Commands → Server
```

## Store 列表

### 1. auth.store.ts

```typescript
interface AuthStore {
  apiKey: string | null;
  tenantId: string | null;
  role: "admin" | "operator" | "viewer" | null;
  permissions: string[];
  isAuthenticated: boolean;
  login: (apiKey: string) => Promise<void>;
  logout: () => void;
  hasPermission: (action: string) => boolean;
}
```

登录流程：`GET /healthz` 携带 API Key，200 表示有效，从 Key 配置提取 tenant_id 和 role。

### 2. metrics.store.ts

```typescript
interface MetricsStore {
  snapshot: MetricsSnapshot | null;
  timeseries: Record<string, Array<{ timestamp: string; value: number }>>;
  latency: { p50: number; p95: number; p99: number; by_agent: Record<string, { p50: number; p95: number; p99: number }> } | null;
  health: { status: string; uptime_seconds: number; version: string } | null;
  timeRange: "1h" | "6h" | "24h" | "7d";
  setTimeRange: (range: string) => void;
  fetchMetrics: () => Promise<void>;
  fetchTimeseries: (metric: string) => Promise<void>;
  fetchLatency: () => Promise<void>;
  fetchHealth: () => Promise<void>;
  onMetricsPush: (snapshot: MetricsSnapshot) => void;
}
```

### 3. sessions.store.ts

```typescript
interface SessionsStore {
  sessions: SessionListItem[];
  total: number;
  filters: { state?: string; agent_id?: string; tenant_id?: string };
  pagination: { offset: number; limit: number };
  currentSession: {
    session: AgentSession;
    goals: Goal[];
    workingMemory: WorkingMemoryRecord[];
    events: NeuroCoreEvent[];
    activeRun: boolean;
  } | null;
  fetchSessions: (filters?, pagination?) => Promise<void>;
  fetchSessionDetail: (sessionId: string) => Promise<void>;
  fetchSessionEvents: (sessionId: string) => Promise<void>;
  createSession: (agentId: string, payload) => Promise<string>;
  cancelSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendInput: (sessionId: string, input) => Promise<void>;
  resumeSession: (sessionId: string, input?) => Promise<void>;
  onSessionEvent: (event: NeuroCoreEvent) => void;
}
```

### 4. traces.store.ts

```typescript
interface TracesStore {
  traces: CycleTraceRecord[];
  selectedCycleId: string | null;
  selectedCycle: CycleTraceRecord | null;
  workspace: WorkspaceSnapshot | null;
  fetchTraces: (sessionId: string) => Promise<void>;
  fetchWorkspace: (sessionId: string, cycleId: string) => Promise<void>;
  selectCycle: (cycleId: string) => void;
}
```

### 5. goals.store.ts

```typescript
interface GoalsStore {
  goals: Goal[];
  goalTree: Map<string, Goal[]>;
  selectedGoalId: string | null;
  fetchGoals: (sessionId: string) => Promise<void>;
  selectGoal: (goalId: string) => void;
  buildTree: (goals: Goal[]) => Map<string, Goal[]>;
}
```

`goalTree` 按 `parent_goal_id` 分组：`undefined` 为根节点。

### 6. memory.store.ts

```typescript
interface MemoryStore {
  activeLayer: "working" | "episodic" | "semantic" | "procedural";
  workingMemory: WorkingMemoryRecord[];
  episodes: Episode[];
  semanticRecords: SemanticMemoryRecord[];
  skills: SkillDefinition[];
  searchQuery: string;
  setActiveLayer: (layer: string) => void;
  setSearchQuery: (query: string) => void;
  fetchWorkingMemory: (sessionId: string) => Promise<void>;
  fetchEpisodes: (sessionId: string) => Promise<void>;
  fetchSemantic: (sessionId: string) => Promise<void>;
  fetchSkills: (sessionId: string) => Promise<void>;
}
```

### 7. workspace.store.ts

```typescript
interface WorkspaceStore {
  snapshot: WorkspaceSnapshot | null;
  selectedProposalId: string | null;
  fetchWorkspace: (sessionId: string, cycleId: string) => Promise<void>;
  selectProposal: (proposalId: string) => void;
}
```

### 8. multi-agent.store.ts

```typescript
interface MultiAgentStore {
  agents: AgentDescriptor[];
  delegations: DelegationRequest[];
  delegationResponses: Map<string, DelegationResponse>;
  assignments: GoalAssignment[];
  selectedAgentId: string | null;
  fetchAgents: () => Promise<void>;
  fetchDelegations: () => Promise<void>;
  onAgentEvent: (event: NeuroCoreEvent) => void;
  onDelegationEvent: (event: NeuroCoreEvent) => void;
}
```

### 9. world-model.store.ts

```typescript
interface WorldModelStore {
  entities: WorldEntity[];
  relations: WorldRelation[];
  conflicts: WorldStateDiff[];
  queryFilters: WorldStateQuery;
  selectedEntityId: string | null;
  selectedRelationId: string | null;
  fetchWorldState: (sessionId: string) => Promise<void>;
  setQueryFilters: (filters: Partial<WorldStateQuery>) => void;
  onWorldStateUpdate: (diff: WorldStateDiff) => void;
}
```

### 10. devices.store.ts

```typescript
interface DevicesStore {
  devices: DeviceInfo[];
  sensorReadings: Map<string, SensorReading[]>;
  actuatorResults: ActuatorResult[];
  selectedDeviceId: string | null;
  fetchDevices: () => Promise<void>;
  fetchSensorReadings: (sensorId: string) => Promise<void>;
  onSensorReading: (reading: SensorReading) => void;
  onDeviceEvent: (event: NeuroCoreEvent) => void;
}
```

### 11. evals.store.ts

```typescript
interface EvalsStore {
  runs: EvalRunReport[];
  currentRun: EvalRunReport | null;
  comparison: EvalComparison | null;
  trendData: Array<{ run_id: string; pass_rate: number; timestamp: string }>;
  fetchRuns: () => Promise<void>;
  fetchRun: (runId: string) => Promise<void>;
  fetchComparison: (runA: string, runB: string) => Promise<void>;
  deleteRun: (runId: string) => Promise<void>;
  runEval: (agentId: string, cases: EvalCase[]) => Promise<string>;
}
```

### 12. approvals.store.ts

```typescript
interface ApprovalsStore {
  pendingApprovals: ApprovalRequest[];
  approvalHistory: ApprovalRequest[];
  auditLogs: AuditLogEntry[];
  selectedApprovalId: string | null;
  fetchPendingApprovals: () => Promise<void>;
  fetchApprovalHistory: (filters?) => Promise<void>;
  fetchAuditLogs: (filters?) => Promise<void>;
  decideApproval: (approvalId: string, decision, approverId, comment?) => Promise<void>;
  onNewApproval: (approval: ApprovalRequest) => void;
  onApprovalDecision: (approval: ApprovalRequest) => void;
}
```

## Store 与 WebSocket 的绑定

每个 store 在创建时注册对应通道的回调。`ws-client.ts` 管理器负责：

1. 连接建立后自动订阅全局通道（`metrics`, `events`, `approvals`, `agents`, `devices`）
2. 页面挂载时订阅会话级通道（`session:{id}`, `world:{id}`）
3. 页面卸载时取消订阅
4. 事件分发到对应 store 的 `on*` 方法

```typescript
// ws-client.ts 事件分发示例
wsClient.on("event", (msg: WsMessage) => {
  if (msg.channel === "metrics") metricsStore.onMetricsPush(msg.payload);
  if (msg.channel.startsWith("session:")) sessionsStore.onSessionEvent(msg.payload);
  if (msg.channel === "approvals") approvalsStore.onNewApproval(msg.payload);
  if (msg.channel === "agents") multiAgentStore.onAgentEvent(msg.payload);
  if (msg.channel === "devices") devicesStore.onDeviceEvent(msg.payload);
});
```
