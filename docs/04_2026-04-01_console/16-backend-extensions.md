# 后端扩展

## 概述

Console 的完整运行需要 runtime-server 新增以下能力：

1. **WebSocket Server** — 双向实时通信
2. **MetricsStore** — 时序指标存储
3. **AuditStore** — 审计日志存储
4. **ConfigStore** — Agent Profile 和策略模板持久化
5. **18 个新 REST 端点**

## 新增文件

在 `packages/runtime-server/src/` 下新增：

### ws-server.ts

WebSocket 升级处理器。

```typescript
export interface WsServerOptions {
  server: HttpServer;
  authenticator: Authenticator;
  eventBus: EventBus;
  agentHandles: Map<string, AgentSessionHandle>;
}

export function createWsServer(options: WsServerOptions): void;
```

职责：
- 监听 HTTP server 的 `upgrade` 事件
- 校验 API Key，提取 tenant_id
- 管理连接池（per tenant）
- 处理 subscribe/unsubscribe/command 消息
- 心跳管理（30s ping，3 次无 pong 断开）
- 事件扇出（从 EventBus 到订阅连接）

复用现有的 `AgentSessionHandle.subscribeToEvents()` 机制获取事件流。

### metrics-store.ts

时序指标环形缓冲存储。

```typescript
export interface MetricsStore {
  record(metric: string, value: number, timestamp?: string): void;
  query(metric: string, window: string, interval: string): Array<{ timestamp: string; value: number }>;
  getLatencyPercentiles(window: string): { p50: number; p95: number; p99: number; by_agent: Record<string, { p50: number; p95: number; p99: number }> };
  getSnapshot(): MetricsSnapshot;
}

export function createInMemoryMetricsStore(retentionMs?: number): MetricsStore;
```

记录的指标：
- `sessions_created` — 计数器
- `cycles_executed` — 计数器
- `cycle_latency_ms` — 直方图
- `errors` — 计数器
- `eval_pass_rate` — 快照值

默认保留 24 小时，1 分钟粒度。

### audit-store.ts

只追加审计日志存储。

```typescript
export interface AuditEntry {
  entry_id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface AuditStore {
  record(entry: Omit<AuditEntry, "entry_id" | "timestamp">): Promise<AuditEntry>;
  query(filters: { tenant_id?: string; user_id?: string; action?: string; from?: string; to?: string; limit?: number; offset?: number }): Promise<{ entries: AuditEntry[]; total: number }>;
}

export function createInMemoryAuditStore(): AuditStore;
export function createSqliteAuditStore(dbPath: string): AuditStore;
```

遵循现有 `eval-store.ts` 的 SPI + InMemory/Sqlite 模式。

记录的事件：
- 审批决策（approve/reject）
- 配置变更
- Session 取消/删除
- API Key 创建/撤销

### config-store.ts

Agent Profile 和策略模板持久化。

```typescript
export interface ConfigStore {
  getProfile(agentId: string): Promise<AgentProfile | null>;
  setProfile(agentId: string, profile: AgentProfile): Promise<void>;
  listProfiles(): Promise<Array<{ agent_id: string; name: string; version: string }>>;
  listPolicies(tenantId?: string): Promise<PolicyTemplate[]>;
  getPolicy(policyId: string): Promise<PolicyTemplate | null>;
  createPolicy(policy: Omit<PolicyTemplate, "id">): Promise<PolicyTemplate>;
  updatePolicy(policyId: string, policy: Partial<PolicyTemplate>): Promise<PolicyTemplate>;
  deletePolicy(policyId: string): Promise<void>;
  listApiKeys(tenantId?: string): Promise<ApiKeyEntry[]>;
  createApiKey(entry: { tenant_id: string; role: string; expiration?: string }): Promise<{ key_id: string; key: string }>;
  revokeApiKey(keyId: string): Promise<void>;
}
```

## 新增 REST 端点

在现有 `handleRequest` 方法中扩展路由：

### Metrics

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/metrics/timeseries` | Query MetricsStore: `?metric=cycles_executed&window=1h&interval=1m` |
| GET | `/v1/metrics/latency` | Query MetricsStore: `?window=1h` → percentiles |

### Agents

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/agents` | List agent IDs from `this.agents` Map |
| GET | `/v1/agents/:id/profile` | Return `agent.getProfile()` via ConfigStore |
| PUT | `/v1/agents/:id/profile` | Update profile in ConfigStore, record audit |

### Multi-Agent

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/agents-registry` | List `AgentDescriptor[]` from AgentRegistry |
| GET | `/v1/delegations` | List DelegationRequest[] from DelegationStore |

### World & Devices

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/sessions/:id/world-state` | Return WorldStateGraph snapshot: `{ entities, relations }` |
| GET | `/v1/devices` | List DeviceInfo[] from DeviceRegistry |
| GET | `/v1/devices/:id/readings` | List recent SensorReading[] |
| GET | `/v1/devices/:id/commands` | List recent ActuatorResult[] |

### Memory

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/sessions/:id/memory/semantic` | Return SemanticMemoryRecord[] |
| GET | `/v1/sessions/:id/skills` | Return SkillDefinition[] from ProceduralMemory |

### Config

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/policies` | List from ConfigStore |
| POST | `/v1/policies` | Create in ConfigStore |
| PUT | `/v1/policies/:id` | Update in ConfigStore |
| DELETE | `/v1/policies/:id` | Delete from ConfigStore |

### Auth & Audit

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/api-keys` | List keys for tenant from ConfigStore |
| POST | `/v1/api-keys` | Create key in ConfigStore |
| DELETE | `/v1/api-keys/:id` | Revoke key in ConfigStore |
| GET | `/v1/audit-logs` | Query AuditStore |

### Approvals

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/approvals/:id/context` | Return PendingApprovalContextSnapshot |

## 端点总计

| 分类 | 已有 | 新增 | 合计 |
|---|---|---|---|
| Session | 10 | 3 | 13 |
| Approval | 3 | 1 | 4 |
| Eval | 5 | 0 | 5 |
| Metrics | 2 | 2 | 4 |
| Agents | 0 | 3 | 3 |
| Multi-Agent | 0 | 2 | 2 |
| World/Device | 0 | 5 | 5 |
| Config | 0 | 6 | 6 |
| Auth/Audit | 0 | 4 | 4 |
| Health | 1 | 0 | 1 |
| **Total** | **21** | **26** | **47** |

## 集成点

### runtime-server.ts 修改

```typescript
// 新增属性
private metricsStore: MetricsStore;
private auditStore: AuditStore;
private configStore: ConfigStore;

// 构造函数中初始化
this.metricsStore = createInMemoryMetricsStore(24 * 60 * 60 * 1000);
this.auditStore = createInMemoryAuditStore();
this.configStore = createInMemoryConfigStore();

// HTTP server 创建后
createWsServer({
  server: this.httpServer,
  authenticator: this.authenticator,
  eventBus: this.eventBus,
  agentHandles: this.handles,
});

// handleRequest 中添加新路由
// Metrics 端点
// Agent/Config 端点
// World/Device 端点
// Audit 端点
```

### 事件记录

在以下位置添加 metrics 记录：
- Session 创建时：`metricsStore.record("sessions_created", 1)`
- Cycle 完成时：`metricsStore.record("cycles_executed", 1)` + `metricsStore.record("cycle_latency_ms", latency)`
- Error 时：`metricsStore.record("errors", 1)`
- Eval 完成时：更新 pass_rate snapshot

在以下位置添加 audit 记录：
- 审批决策：`auditStore.record({ action: "approval.approve", ... })`
- 配置变更：`auditStore.record({ action: "config.update", ... })`
- Session 取消：`auditStore.record({ action: "session.cancel", ... })`
