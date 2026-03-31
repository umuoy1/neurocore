# A. 多 Agent 分布式调度 — 详细设计

> FR-28 ~ FR-35 · Milestone 9 · 依赖 Milestone 8（世界模型）

## 1. 概述

### 1.1 方向定义

将 NeuroCore 从单 Agent 认知引擎扩展为多 Agent 分布式认知平台。多个 Agent 实例可在同一任务空间中协作，通过注册发现、任务委派、消息通信和协调策略完成单个 Agent 无法独立处理的复杂任务。

### 1.2 核心目标

1. **Agent 注册与发现**：Agent 实例可动态注册、发现、退出，支持能力描述和心跳检测
2. **任务委派**：当前 Agent 可将子任务委派给最合适的 Agent，支持单播、广播、竞标三种模式
3. **跨 Agent 通信**：提供统一的消息总线，支持同步请求、异步事件、流式传输
4. **多种协调策略**：层级式（supervisor-worker）、对等式（peer-to-peer）、市场式（auction/bidding）
5. **分布式目标管理**：跨 Agent 的目标分解、进度同步、状态聚合
6. **Agent 生命周期**：实例创建、销毁、故障恢复、优雅退出
7. **分布式可观测性**：跨 Agent trace、span 关联、聚合 metrics

### 1.3 前置依赖

| 依赖 | 说明 |
|---|---|
| Milestone 8（Direction B：世界模型） | 多 Agent 共享世界状态需要 WorldStateGraph 提供一致性视图 |
| 现有 `ActionType.delegate` | 协议层已预留 delegate 动作类型，本方向将其落地 |
| 现有 Global Workspace broadcast-compete-select | 多 Agent 层的协调策略将复用单 Agent 内的竞争广播模式 |

---

## 2. 需求分解 (FR-28 ~ FR-35)

### FR-28: Agent Registry

| 属性 | 值 |
|---|---|
| **ID** | FR-28 |
| **标题** | Agent 注册、发现与心跳 |
| **优先级** | P0 |
| **依赖** | 无 |

**描述**：

提供中心化的 Agent 注册中心，每个 Agent 实例启动时向注册中心注册自身能力描述（AgentDescriptor），注册中心维护活跃 Agent 列表并通过心跳检测剔除失联实例。其他 Agent 可按能力标签、domain、负载状态查询可用 Agent。

**验收标准**：

- [ ] Agent 启动时自动注册，关闭时自动注销
- [ ] 心跳超时（默认 30s）后注册中心标记为 `unreachable`，连续 3 次后标记为 `terminated`
- [ ] 按 `capabilities`、`domain`、`status`、`capacity` 查询可用 Agent
- [ ] 注册中心支持 in-memory 和可插拔持久化后端

---

### FR-29: Task Delegation Protocol

| 属性 | 值 |
|---|---|
| **ID** | FR-29 |
| **标题** | 任务分配协议 |
| **优先级** | P0 |
| **依赖** | FR-28 |

**描述**：

当 CycleEngine 执行 `ActionType.delegate` 时，通过 TaskDelegator 将子任务分配给目标 Agent。支持三种分配模式：

- **单播（unicast）**：指定目标 Agent ID 直接分配
- **广播（broadcast）**：向所有符合条件的 Agent 广播，取第一个接受者
- **竞标（auction）**：向候选 Agent 发起竞标，根据报价（预估时间/成本/confidence）选择最优者

**验收标准**：

- [ ] `CandidateAction.tool_args` 中 `delegation_mode` 支持 `unicast | broadcast | auction`
- [ ] 委派超时（默认 60s）后回退到本地执行或报错
- [ ] 委派结果作为 Observation 回写到发起方的 Cycle
- [ ] 支持嵌套委派（Agent A → Agent B → Agent C），深度可配置（默认 max_depth=3）

---

### FR-30: Inter-Agent Communication Bus

| 属性 | 值 |
|---|---|
| **ID** | FR-30 |
| **标题** | 跨 Agent 消息传递总线 |
| **优先级** | P0 |
| **依赖** | FR-28 |

**描述**：

提供统一的 InterAgentBus 消息传递层，所有跨 Agent 通信（委派、协调、状态同步）均通过该总线进行。支持三种通信模式：

- **Request-Response（同步）**：发送请求并等待响应，支持超时
- **Event Broadcast（异步）**：发布事件到主题，订阅者异步接收
- **Stream（流式）**：建立持续数据流通道，用于实时状态同步

**验收标准**：

- [ ] 消息投递至少一次（at-least-once），支持幂等处理
- [ ] 提供 in-process 实现（用于测试和单机多 Agent）和可插拔传输层（为未来分布式部署预留）
- [ ] 消息序列化使用 JSON，envelope 包含 correlation_id 用于 trace 关联
- [ ] 背压机制：当接收方处理不过来时通知发送方降速

---

### FR-31: Coordination Strategies

| 属性 | 值 |
|---|---|
| **ID** | FR-31 |
| **标题** | 协调策略 |
| **优先级** | P1 |
| **依赖** | FR-28, FR-29, FR-30 |

**描述**：

提供三种协调策略，通过 Strategy Pattern 实现可插拔切换：

1. **层级式（Hierarchical）**：Supervisor Agent 分解任务，分配给 Worker Agent，汇总结果。树形拓扑，权限自上而下。
2. **对等式（Peer-to-peer）**：Agent 之间平等协商，通过投票或共识达成协调。适用于无明确主从关系的场景。
3. **市场式（Market-based）**：任务发布为"招标"，Agent 根据自身能力和负载"投标"，由发布方或仲裁方选择中标者。

**验收标准**：

- [ ] 三种策略均有默认实现，可通过 `AgentProfile.metadata.coordination_strategy` 切换
- [ ] 层级式支持多层树（Supervisor → Sub-supervisor → Worker）
- [ ] 对等式支持简单多数投票和加权投票
- [ ] 市场式竞标超时默认 10s，无投标者时回退到 broadcast

---

### FR-32: Shared World State

| 属性 | 值 |
|---|---|
| **ID** | FR-32 |
| **标题** | 多 Agent 共享世界状态视图 |
| **优先级** | P1 |
| **依赖** | FR-30, Milestone 8（WorldStateGraph） |

**描述**：

基于 Milestone 8 的 WorldStateGraph，为多 Agent 场景提供共享世界状态视图。多个 Agent 可并发读取和写入世界状态，通过版本向量（version vector）解决冲突。

**验收标准**：

- [ ] 每个 Agent 的 `WorkspaceSnapshot.world_state_digest` 反映共享世界状态的本地视图
- [ ] 写入冲突通过 last-writer-wins + version vector 解决，冲突事件可被订阅
- [ ] 世界状态变更自动通过 InterAgentBus 广播给相关 Agent
- [ ] 支持 namespace 隔离：Agent 可声明只关注特定 namespace 的状态变更

---

### FR-33: Distributed Goal Management

| 属性 | 值 |
|---|---|
| **ID** | FR-33 |
| **标题** | 跨 Agent 目标分解与状态同步 |
| **优先级** | P1 |
| **依赖** | FR-29, FR-30 |

**描述**：

将现有的单 Session Goal Tree 扩展为跨 Agent 的分布式目标树。Supervisor Agent 可将 Goal 分解为子 Goal 并分配给不同 Agent，子 Goal 的状态变更自动向上传播。

**验收标准**：

- [ ] `Goal` 新增 `assigned_agent_id` 字段标识负责的 Agent
- [ ] 子 Goal 状态变更（completed/failed/blocked）触发父 Goal 状态重新评估
- [ ] 跨 Agent 的 Goal 进度可在发起方聚合查询
- [ ] Goal 分配支持重新分配（当原 Agent 不可用时）

---

### FR-34: Agent Lifecycle Management

| 属性 | 值 |
|---|---|
| **ID** | FR-34 |
| **标题** | Agent 实例生命周期管理 |
| **优先级** | P1 |
| **依赖** | FR-28 |

**描述**：

管理 Agent 实例的完整生命周期，包括按需创建（scaling）、优雅退出（draining）、故障检测与恢复。

**验收标准**：

- [ ] Agent 实例状态机：`registering → idle → busy → draining → terminated`
- [ ] draining 状态：不接受新任务，等待当前任务完成后退出
- [ ] 故障检测：心跳超时后，将该 Agent 的未完成任务重新分配
- [ ] 支持手动触发 Agent 创建/销毁 API
- [ ] 实例元数据（创建时间、累计任务数、平均延迟）可查询

---

### FR-35: Multi-Agent Observability

| 属性 | 值 |
|---|---|
| **ID** | FR-35 |
| **标题** | 分布式可观测性 |
| **优先级** | P2 |
| **依赖** | FR-28, FR-30 |

**描述**：

为多 Agent 场景提供完整的分布式 trace 和 metrics。每个跨 Agent 交互生成关联的 span，支持从入口 Agent 追踪到所有参与 Agent 的完整执行路径。

**验收标准**：

- [ ] 跨 Agent 消息携带 `trace_id` 和 `parent_span_id`，形成 span 树
- [ ] `CycleTrace` 新增 `delegation_span` 字段记录委派调用链
- [ ] 聚合 metrics：跨 Agent 任务完成率、平均委派延迟、Agent 利用率
- [ ] 提供 `GET /v1/traces/distributed/:traceId` API 返回跨 Agent trace 视图

---

## 3. 架构设计

### 3.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                      Multi-Agent Layer                           │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ AgentRegistry │  │TaskDelegator │  │DistributedGoalManager│   │
│  │              │  │              │  │                      │   │
│  │ - register   │  │ - unicast    │  │ - decompose          │   │
│  │ - discover   │  │ - broadcast  │  │ - assign             │   │
│  │ - heartbeat  │  │ - auction    │  │ - sync_status        │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│  ┌──────┴─────────────────┴──────────────────────┴───────────┐   │
│  │                   InterAgentBus                            │   │
│  │  request-response │ event-broadcast │ stream               │   │
│  └──────────────────────────┬────────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────┴────────────────────────────────┐   │
│  │              CoordinationStrategy                          │   │
│  │  hierarchical │ peer-to-peer │ market-based                │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
            ┌──────────────────┴───────────────────┐
            │        Shared World State            │
            │   (WorldStateGraph from M8)          │
            └──────────────────┬───────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────────┐
│                   Single-Agent Runtime (existing)                 │
│                                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │ Cortex  │ │Hippocam-│ │Cerebel- │ │Amygdala │ │  Basal   │  │
│  │(Reasoner)│ │  pal    │ │  lar    │ │ (Risk)  │ │ Ganglia  │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘  │
│       └───────────┴───────────┴───────────┴───────────┘          │
│                           │                                      │
│                 ┌─────────┴──────────┐                           │
│                 │  Global Workspace  │                           │
│                 │ broadcast-compete  │                           │
│                 │    -select         │                           │
│                 └─────────┬──────────┘                           │
│                           │                                      │
│                 ┌─────────┴──────────┐                           │
│                 │   Prefrontal       │                           │
│                 │  (MetaController)  │                           │
│                 └────────────────────┘                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件

| 组件 | 职责 | 所在包 |
|---|---|---|
| `AgentRegistry` | Agent 注册、发现、心跳管理、能力索引 | `multi-agent` |
| `TaskDelegator` | 处理 `ActionType.delegate`，执行单播/广播/竞标分配 | `multi-agent` |
| `InterAgentBus` | 跨 Agent 消息传递，支持三种通信模式 | `multi-agent` |
| `CoordinationStrategy` | 协调策略抽象，三种默认实现 | `multi-agent` |
| `DistributedGoalManager` | 跨 Agent 目标分解、分配、状态聚合 | `multi-agent` |
| `AgentLifecycleManager` | Agent 实例状态机、故障检测、优雅退出 | `multi-agent` |
| `DistributedTracer` | 跨 Agent span 管理、trace 关联 | `multi-agent` |

### 3.3 新增 SPI 接口

#### 3.3.1 AgentDescriptor

```typescript
export type AgentStatus = "registering" | "idle" | "busy" | "draining" | "unreachable" | "terminated";

export interface AgentCapability {
  name: string;
  domain?: string;
  proficiency: number;
  max_concurrent_tasks?: number;
}

export interface AgentDescriptor {
  agent_id: string;
  instance_id: string;
  name: string;
  version: string;
  status: AgentStatus;
  capabilities: AgentCapability[];
  domains: string[];
  current_load: number;
  max_capacity: number;
  endpoint?: string;
  heartbeat_interval_ms: number;
  last_heartbeat_at: string;
  registered_at: string;
  metadata?: Record<string, unknown>;
}
```

#### 3.3.2 InterAgentMessage

```typescript
export type MessagePattern = "request" | "response" | "event" | "stream_start" | "stream_data" | "stream_end";

export interface InterAgentMessage {
  message_id: string;
  correlation_id: string;
  trace_id: string;
  parent_span_id?: string;
  pattern: MessagePattern;
  source_agent_id: string;
  source_instance_id: string;
  target_agent_id?: string;
  topic?: string;
  payload: Record<string, unknown>;
  created_at: string;
  ttl_ms?: number;
}
```

#### 3.3.3 DelegationRequest / DelegationResponse

```typescript
export type DelegationMode = "unicast" | "broadcast" | "auction";

export type DelegationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

export interface DelegationRequest {
  delegation_id: string;
  source_agent_id: string;
  source_session_id: string;
  source_cycle_id: string;
  source_goal_id: string;
  mode: DelegationMode;
  target_agent_id?: string;
  target_capabilities?: string[];
  target_domains?: string[];
  goal: {
    title: string;
    description?: string;
    goal_type: string;
    priority: number;
    constraints?: Array<{ type: string; description: string }>;
    acceptance_criteria?: Array<{ id: string; description: string }>;
  };
  timeout_ms: number;
  max_depth: number;
  current_depth: number;
  context?: Record<string, unknown>;
  created_at: string;
}

export interface AuctionBid {
  agent_id: string;
  instance_id: string;
  estimated_duration_ms: number;
  estimated_cost: number;
  confidence: number;
  reasoning?: string;
}

export interface DelegationResponse {
  delegation_id: string;
  status: DelegationStatus;
  assigned_agent_id?: string;
  assigned_instance_id?: string;
  assigned_session_id?: string;
  bids?: AuctionBid[];
  selected_bid?: AuctionBid;
  result?: {
    status: "success" | "partial" | "failure";
    summary: string;
    payload?: Record<string, unknown>;
  };
  error?: string;
  started_at?: string;
  completed_at?: string;
}
```

#### 3.3.4 CoordinationStrategy 接口

```typescript
export interface CoordinationContext {
  initiator_agent_id: string;
  participating_agents: AgentDescriptor[];
  goal: {
    goal_id: string;
    title: string;
    description?: string;
    priority: number;
  };
  world_state?: Record<string, unknown>;
}

export interface TaskAssignment {
  agent_id: string;
  instance_id: string;
  sub_goal: {
    title: string;
    description?: string;
    priority: number;
    dependencies?: string[];
  };
  estimated_cost?: number;
}

export interface CoordinationResult {
  strategy_name: string;
  assignments: TaskAssignment[];
  coordination_metadata?: Record<string, unknown>;
  reasoning: string;
}

export interface CoordinationStrategy {
  name: string;
  coordinate(ctx: CoordinationContext): Promise<CoordinationResult>;
  resolveConflict?(
    ctx: CoordinationContext,
    conflicting_assignments: TaskAssignment[]
  ): Promise<TaskAssignment[]>;
}
```

#### 3.3.5 AgentRegistry 接口

```typescript
export interface AgentRegistryQuery {
  capabilities?: string[];
  domains?: string[];
  status?: AgentStatus[];
  min_available_capacity?: number;
}

export interface AgentRegistry {
  register(descriptor: AgentDescriptor): Promise<void>;
  deregister(instanceId: string): Promise<void>;
  heartbeat(instanceId: string): Promise<void>;
  discover(query: AgentRegistryQuery): Promise<AgentDescriptor[]>;
  get(instanceId: string): Promise<AgentDescriptor | undefined>;
  listAll(): Promise<AgentDescriptor[]>;
  onStatusChange(callback: (descriptor: AgentDescriptor, previous: AgentStatus) => void): void;
}
```

#### 3.3.6 InterAgentBus 接口

```typescript
export interface MessageHandler {
  (message: InterAgentMessage): Promise<InterAgentMessage | void>;
}

export interface StreamHandler {
  onData(message: InterAgentMessage): void;
  onEnd(): void;
  onError(error: Error): void;
}

export interface InterAgentBus {
  send(message: InterAgentMessage): Promise<InterAgentMessage>;
  publish(topic: string, message: InterAgentMessage): Promise<void>;
  subscribe(topic: string, handler: MessageHandler): () => void;
  openStream(targetInstanceId: string, correlationId: string): Promise<{
    write(data: Record<string, unknown>): void;
    end(): void;
  }>;
  onStream(handler: (correlationId: string, stream: StreamHandler) => void): void;
  close(): Promise<void>;
}
```

#### 3.3.7 DistributedGoalManager 接口

```typescript
export interface GoalAssignment {
  goal_id: string;
  agent_id: string;
  instance_id: string;
  session_id: string;
  status: string;
  progress?: number;
  updated_at: string;
}

export interface DistributedGoalManager {
  decompose(
    parentGoalId: string,
    subGoals: Array<{ title: string; description?: string; priority: number }>,
    strategy: CoordinationStrategy,
    agents: AgentDescriptor[]
  ): Promise<GoalAssignment[]>;
  getAssignment(goalId: string): Promise<GoalAssignment | undefined>;
  listAssignments(parentGoalId: string): Promise<GoalAssignment[]>;
  updateStatus(goalId: string, status: string, progress?: number): Promise<void>;
  reassign(goalId: string, newAgentId: string, newInstanceId: string): Promise<void>;
  aggregateProgress(parentGoalId: string): Promise<{ total: number; completed: number; progress: number }>;
}
```

### 3.4 协调策略详解

#### 3.4.1 层级式（Hierarchical）

```
             ┌─────────────┐
             │  Supervisor  │
             │   Agent      │
             └──────┬───────┘
                    │ decompose + assign
          ┌─────────┼─────────┐
          ▼         ▼         ▼
     ┌────────┐ ┌────────┐ ┌────────┐
     │Worker A│ │Worker B│ │Worker C│
     └────────┘ └────────┘ └────────┘
```

**流程**：

1. Supervisor 接收顶层 Goal
2. Supervisor 的 Reasoner 将 Goal 分解为多个子 Goal
3. 根据 Worker 的 capabilities 和负载分配子 Goal
4. Worker 独立执行，完成后报告结果
5. Supervisor 汇总结果，判断顶层 Goal 是否完成

**配置**：

```typescript
interface HierarchicalConfig {
  max_tree_depth: number;
  worker_selection: "round_robin" | "least_loaded" | "best_fit";
  result_aggregation: "all_success" | "majority" | "any_success";
}
```

#### 3.4.2 对等式（Peer-to-peer）

```
     ┌────────┐     ┌────────┐
     │Agent A │◄───►│Agent B │
     └────┬───┘     └───┬────┘
          │             │
          └──────┬──────┘
                 ▼
          ┌────────────┐
          │  Agent C   │
          └────────────┘
```

**流程**：

1. 发起方提议任务分解方案
2. 所有参与 Agent 对方案进行投票
3. 达成共识后各自领取子任务
4. 执行过程中可发起新的投票以调整分工

**配置**：

```typescript
interface PeerToPeerConfig {
  consensus_mode: "simple_majority" | "weighted_majority" | "unanimous";
  voting_timeout_ms: number;
  agent_weights?: Record<string, number>;
}
```

#### 3.4.3 市场式（Market-based）

```
     ┌─────────────┐
     │  Auctioneer  │ ── publish task
     └──────┬───────┘
            │
     ┌──────┴──────────────────┐
     ▼             ▼           ▼
  ┌──────┐    ┌──────┐    ┌──────┐
  │Bid A │    │Bid B │    │Bid C │
  │$0.02 │    │$0.01 │    │$0.03 │
  │300ms │    │500ms │    │200ms │
  │conf:8│    │conf:9│    │conf:7│
  └──────┘    └──────┘    └──────┘
                 ▲
                 │ selected (best score)
```

**流程**：

1. 发起方发布任务招标（DelegationRequest with `mode: "auction"`）
2. 候选 Agent 评估自身能力并提交投标（AuctionBid）
3. 发起方根据综合评分（duration × weight + cost × weight + confidence × weight）选择中标者
4. 中标者接受任务并执行

**配置**：

```typescript
interface MarketBasedConfig {
  auction_timeout_ms: number;
  min_bids: number;
  scoring_weights: {
    duration: number;
    cost: number;
    confidence: number;
  };
  reserve_price?: number;
}
```

### 3.5 通信模式

#### 3.5.1 Request-Response（同步）

用于委派任务、查询状态等需要即时响应的场景。

```
Agent A                    InterAgentBus                    Agent B
  │                            │                              │
  │── send(request) ──────────►│                              │
  │                            │── deliver ──────────────────►│
  │                            │                              │
  │                            │◄── response ─────────────────│
  │◄── return response ───────│                              │
  │                            │                              │
```

**超时机制**：默认 30s，超时后抛出 `DelegationTimeoutError`。

#### 3.5.2 Event Broadcast（异步）

用于状态变更通知、世界状态更新等不需要响应的场景。

```
Agent A                    InterAgentBus              Agent B, C, D
  │                            │                          │
  │── publish(topic, event) ──►│                          │
  │                            │── fan-out ──────────────►│ (all subscribers)
  │                            │                          │
```

**预定义 Topic**：

| Topic | 用途 |
|---|---|
| `agent.status` | Agent 状态变更 |
| `goal.progress` | 目标进度更新 |
| `world.state_changed` | 共享世界状态变更 |
| `delegation.status` | 委派任务状态变更 |

#### 3.5.3 Stream（流式）

用于长时间任务的实时进度推送。

```
Agent A                    InterAgentBus                    Agent B
  │                            │                              │
  │── openStream ─────────────►│── establish ────────────────►│
  │                            │                              │
  │◄── stream_data ────────────│◄── stream_data ──────────────│
  │◄── stream_data ────────────│◄── stream_data ──────────────│
  │◄── stream_end  ────────────│◄── stream_end  ──────────────│
  │                            │                              │
```

---

## 4. 生命周期与状态机

### 4.1 Agent 实例状态机

```
                    register()
     ───────────► ┌─────────────┐
                  │ registering │
                  └──────┬──────┘
                         │ registration confirmed
                         ▼
                  ┌─────────────┐ ◄──── task completed
         ┌──────►│    idle      │────────────────────┐
         │       └──────┬──────┘                     │
         │              │ task assigned              │
         │              ▼                            │
         │       ┌─────────────┐                     │
         │       │    busy     │─────────────────────┘
         │       └──────┬──────┘
         │              │ drain()
         │              ▼
         │       ┌─────────────┐
         │       │  draining   │ ── 不接受新任务，等待当前任务完成
         │       └──────┬──────┘
         │              │ all tasks done / force terminate
         │              ▼
         │       ┌─────────────┐
         └───────│ terminated  │ ── 清理资源，从注册中心移除
                 └─────────────┘

                 heartbeat timeout (idle/busy)
                         │
                         ▼
                 ┌──────────────┐
                 │ unreachable  │ ── 3 次超时后转为 terminated
                 └──────────────┘
```

### 4.2 状态转换规则

| 当前状态 | 触发事件 | 目标状态 | 副作用 |
|---|---|---|---|
| `registering` | 注册确认 | `idle` | emit `agent.registered` |
| `idle` | 接受任务 | `busy` | emit `agent.status_changed` |
| `busy` | 任务完成 | `idle` | emit `agent.status_changed` |
| `busy` | drain 请求 | `draining` | 停止接受新任务 |
| `idle` | drain 请求 | `terminated` | 直接退出（无进行中任务） |
| `draining` | 所有任务完成 | `terminated` | emit `agent.deregistered` |
| `idle` / `busy` | 心跳超时 | `unreachable` | 启动故障恢复流程 |
| `unreachable` | 心跳恢复 | `idle` / `busy` | 取消故障恢复 |
| `unreachable` | 连续超时 × 3 | `terminated` | 重新分配未完成任务 |
| 任意 | deregister() | `terminated` | emit `agent.deregistered` |

### 4.3 Delegation 状态机

```
  ┌─────────┐
  │ pending  │ ── 已发出委派请求
  └────┬─────┘
       │
  ┌────┴─────────────┬────────────┐
  ▼                  ▼            ▼
┌──────────┐  ┌───────────┐  ┌─────────┐
│ accepted │  │ rejected  │  │ timeout │
└────┬─────┘  └───────────┘  └─────────┘
     │
     ▼
┌──────────┐
│ running  │
└────┬─────┘
     │
  ┌──┴──────┐
  ▼         ▼
┌─────────┐ ┌────────┐
│completed│ │ failed │
└─────────┘ └────────┘
```

---

## 5. 与现有模块的交互

### 5.1 模块影响分析

| 现有模块 | 影响 | 改动范围 |
|---|---|---|
| **Cortex / Reasoner** | 需要能生成 `ActionType.delegate` 的 CandidateAction，包含委派参数 | Reasoner 实现需感知可委派的 Agent 列表 |
| **Hippocampal / Memory** | 跨 Agent 的 episodic memory 可选择性共享 | MemoryProvider 新增跨 Agent 检索接口（可选） |
| **Cerebellar / World Model** | 提供 SharedWorldState 的底层数据结构 | 依赖 M8 的 WorldStateGraph |
| **Amygdala / Risk** | 委派操作本身需要风险评估（目标 Agent 可信度） | PolicyProvider 新增委派相关策略 |
| **Basal Ganglia / Skill** | Agent 的技能描述成为 AgentCapability 的一部分 | SkillProvider 输出映射到 AgentDescriptor.capabilities |
| **Prefrontal / Meta** | 委派决策纳入 MetaDecision 的评估维度 | MetaController 需要评估"委派 vs 本地执行"的 trade-off |
| **Global Workspace** | 多 Agent 层是 Workspace 之上的新层，不修改 Workspace 内部逻辑 | 无直接改动 |
| **CycleEngine** | 处理 `ActionType.delegate` 时调用 TaskDelegator | 新增 delegate 执行分支 |
| **EventBus** | 新增多 Agent 相关事件类型 | 扩展 `NeuroCoreEventType` |
| **runtime-server** | 新增 Agent 管理和分布式 trace API | 新增路由 |

### 5.2 CycleEngine 中的委派流程

```
CycleEngine.executeCycle()
  │
  ├── ... (existing: workspace → proposals → compete → meta-decision)
  │
  ├── if selected_action.action_type === "delegate"
  │     │
  │     ├── TaskDelegator.delegate(delegation_request)
  │     │     │
  │     │     ├── mode: unicast → 直接发送到目标 Agent
  │     │     ├── mode: broadcast → 广播到所有符合条件的 Agent
  │     │     └── mode: auction → 发起竞标，等待投标，选择最优
  │     │
  │     ├── 等待 DelegationResponse
  │     │
  │     └── 将结果转为 Observation 写入当前 Cycle
  │
  └── ... (existing: observation → memory → trace → checkpoint)
```

---

## 6. 新增事件

### 6.1 事件类型定义

```typescript
export type MultiAgentEventType =
  | "agent.registered"
  | "agent.deregistered"
  | "agent.status_changed"
  | "agent.heartbeat_lost"
  | "delegation.requested"
  | "delegation.accepted"
  | "delegation.rejected"
  | "delegation.completed"
  | "delegation.failed"
  | "delegation.timeout"
  | "auction.started"
  | "auction.bid_received"
  | "auction.completed"
  | "coordination.started"
  | "coordination.assignment_created"
  | "coordination.completed"
  | "world_state.conflict_detected"
  | "world_state.conflict_resolved";
```

### 6.2 事件详细说明

| 事件 | 触发时机 | Payload |
|---|---|---|
| `agent.registered` | Agent 实例注册成功 | `AgentDescriptor` |
| `agent.deregistered` | Agent 实例注销 | `{ instance_id, reason }` |
| `agent.status_changed` | Agent 状态转换 | `{ instance_id, previous, current }` |
| `agent.heartbeat_lost` | 心跳超时 | `{ instance_id, last_heartbeat_at }` |
| `delegation.requested` | 发起委派请求 | `DelegationRequest` |
| `delegation.accepted` | 目标 Agent 接受委派 | `{ delegation_id, agent_id, instance_id }` |
| `delegation.rejected` | 目标 Agent 拒绝委派 | `{ delegation_id, agent_id, reason }` |
| `delegation.completed` | 委派任务完成 | `DelegationResponse` |
| `delegation.failed` | 委派任务失败 | `DelegationResponse` |
| `delegation.timeout` | 委派超时 | `{ delegation_id, timeout_ms }` |
| `auction.started` | 竞标开始 | `{ delegation_id, candidate_count }` |
| `auction.bid_received` | 收到投标 | `AuctionBid` |
| `auction.completed` | 竞标结束 | `{ delegation_id, winner_agent_id, bid_count }` |
| `coordination.started` | 协调流程启动 | `{ strategy, agent_count, goal_id }` |
| `coordination.assignment_created` | 任务分配完成 | `TaskAssignment` |
| `coordination.completed` | 协调流程结束 | `CoordinationResult` |
| `world_state.conflict_detected` | 共享状态写入冲突 | `{ namespace, key, conflicting_agents }` |
| `world_state.conflict_resolved` | 冲突解决 | `{ namespace, key, resolution }` |

---

## 7. 包结构

### 7.1 新增包

```
packages/
├── multi-agent/                    # 新增
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── types.ts                # AgentDescriptor, DelegationRequest, etc.
│       ├── registry/
│       │   ├── agent-registry.ts   # AgentRegistry 接口 + InMemoryAgentRegistry
│       │   └── heartbeat-monitor.ts
│       ├── delegation/
│       │   ├── task-delegator.ts   # TaskDelegator
│       │   └── delegation-executor.ts
│       ├── bus/
│       │   ├── inter-agent-bus.ts  # InterAgentBus 接口
│       │   └── in-process-bus.ts   # InProcessInterAgentBus
│       ├── coordination/
│       │   ├── coordination-strategy.ts
│       │   ├── hierarchical-strategy.ts
│       │   ├── peer-to-peer-strategy.ts
│       │   └── market-based-strategy.ts
│       ├── goal/
│       │   └── distributed-goal-manager.ts
│       ├── lifecycle/
│       │   └── agent-lifecycle-manager.ts
│       └── trace/
│           └── distributed-tracer.ts
├── protocol/                       # 扩展
│   └── src/
│       ├── types.ts                # Goal 新增 assigned_agent_id
│       └── events.ts              # 新增 MultiAgentEventType
├── runtime-core/                   # 扩展
│   └── src/
│       └── cycle/
│           └── cycle-engine.ts    # delegate action 执行分支
└── runtime-server/                 # 扩展
    └── src/
        └── runtime-server.ts      # 新增 Agent 管理 API 路由
```

### 7.2 包依赖关系

```
multi-agent
  ├── protocol          (类型定义)
  ├── runtime-core      (CycleEngine 集成)
  └── (M8) world-model  (SharedWorldState)
```

### 7.3 新增 API 路由

| 方法 | 路径 | 说明 | FR |
|---|---|---|---|
| `POST` | `/v1/agents/register` | 注册 Agent 实例 | FR-28 |
| `DELETE` | `/v1/agents/:instanceId` | 注销 Agent 实例 | FR-28 |
| `POST` | `/v1/agents/:instanceId/heartbeat` | 心跳上报 | FR-28 |
| `GET` | `/v1/agents` | 查询可用 Agent | FR-28 |
| `GET` | `/v1/agents/:instanceId` | 获取 Agent 详情 | FR-28 |
| `POST` | `/v1/delegations` | 发起委派请求 | FR-29 |
| `GET` | `/v1/delegations/:delegationId` | 查询委派状态 | FR-29 |
| `GET` | `/v1/goals/:goalId/assignments` | 查询目标分配 | FR-33 |
| `POST` | `/v1/agents/:instanceId/drain` | 触发 Agent 优雅退出 | FR-34 |
| `GET` | `/v1/traces/distributed/:traceId` | 跨 Agent 分布式 trace | FR-35 |

---

## 8. 验收标准

### Milestone 9 整体验收标准

| # | 标准 | 关联 FR |
|---|---|---|
| AC-1 | 3 个 Agent 实例可同时注册，互相发现，心跳超时后自动标记为 unreachable | FR-28 |
| AC-2 | Agent A 通过 `ActionType.delegate` 将子任务委派给 Agent B，Agent B 执行后结果回写到 Agent A 的 Observation | FR-29 |
| AC-3 | 竞标模式下，3 个 Agent 投标，根据评分选择最优者，落选者收到 rejection 通知 | FR-29, FR-31 |
| AC-4 | InterAgentBus 的 request-response 模式延迟 < 10ms（in-process 实现） | FR-30 |
| AC-5 | 层级式协调：Supervisor 将 Goal 分解为 3 个子 Goal，分配给 3 个 Worker，全部完成后 Supervisor 汇总 | FR-31, FR-33 |
| AC-6 | 对等式协调：3 个 Agent 对任务分解方案投票达成共识 | FR-31 |
| AC-7 | 共享世界状态：Agent A 写入状态后，Agent B 在下一个 Cycle 能读取到 | FR-32 |
| AC-8 | Agent 进入 draining 状态后不接受新委派，当前任务完成后自动转为 terminated | FR-34 |
| AC-9 | 故障恢复：Agent B 心跳超时后，其未完成任务自动重新分配给 Agent C | FR-34 |
| AC-10 | 跨 Agent 的完整 trace 可通过 distributed trace API 查询，包含所有参与 Agent 的 span | FR-35 |
| AC-11 | 所有新增组件有对应的单元测试和集成测试，覆盖率 ≥ 80% | 全部 |
| AC-12 | 嵌套委派（A → B → C）正确执行且 trace 完整，深度超限时报错 | FR-29 |

---

## 9. 风险与缓解

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|---|
| R-1 | 分布式通信引入网络延迟和不可靠性 | 任务完成时间不可预测 | 中 | 先实现 in-process Bus 确保逻辑正确，再接入网络传输层；所有通信带超时和重试 |
| R-2 | 多 Agent 状态一致性难以保证 | 世界状态冲突、重复执行 | 高 | version vector + last-writer-wins；委派请求带幂等 key；delegation 状态机严格单向转换 |
| R-3 | 故障恢复导致任务重复执行 | 副作用重复 | 中 | 重新分配前检查原任务是否已完成（幂等校验）；高 side-effect 任务不自动重新分配，改为通知 Supervisor |
| R-4 | 竞标/投票超时导致任务卡住 | 影响整体进度 | 中 | 超时后 fallback 到 broadcast 或本地执行；配置合理的超时阈值 |
| R-5 | 协调策略选择不当导致低效分工 | Agent 利用率低 | 低 | 默认使用 hierarchical（最简单可预测），提供运行时切换能力；通过 metrics 监控利用率 |
| R-6 | 嵌套委派导致深度爆炸 | 资源耗尽 | 低 | 强制 max_depth 限制（默认 3），超限直接拒绝 |
| R-7 | 对现有 CycleEngine 的改动引入回归 | 单 Agent 模式受影响 | 中 | delegate 分支独立隔离，无 multi-agent 配置时完全不触发；回归测试覆盖现有 132 个测试 |
| R-8 | 依赖 M8（世界模型）延期 | FR-32 无法实施 | 中 | FR-32 是 P1，其他 P0 的 FR（28/29/30）可先行推进，不依赖世界模型 |
