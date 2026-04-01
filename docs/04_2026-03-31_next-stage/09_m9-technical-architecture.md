# M9: 多 Agent 分布式调度 — 技术架构设计

> 基于 `02_multi-agent-scheduling.md` 的 SPI 详细设计，本文档描述实现层面的模块拆分、
> 类结构、依赖注入、数据流时序、错误处理和测试策略。

---

## 1. 包结构与内部模块

### 1.1 `@neurocore/multi-agent`

```
packages/multi-agent/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                        # 公共导出
    ├── types.ts                        # AgentDescriptor / DelegationRequest / InterAgentMessage 等
    ├── registry/
    │   ├── agent-registry.ts           # AgentRegistry 接口
    │   ├── in-memory-agent-registry.ts # InMemoryAgentRegistry 实现
    │   └── heartbeat-monitor.ts        # HeartbeatMonitor（独立可测试）
    ├── bus/
    │   ├── inter-agent-bus.ts          # InterAgentBus 接口
    │   ├── local-inter-agent-bus.ts    # LocalInterAgentBus（同进程实现）
    │   └── message-router.ts           # 消息路由逻辑（unicast/multicast/broadcast）
    ├── delegation/
    │   ├── task-delegator.ts           # TaskDelegator 接口 + 默认实现
    │   ├── delegation-strategies.ts    # CapabilityBasedMatcher / LoadBalancedAssigner / CostAwareSelector
    │   └── auction-manager.ts          # 竞标流程管理
    ├── coordination/
    │   ├── coordination-strategy.ts    # CoordinationStrategy 接口
    │   ├── hierarchical-strategy.ts    # HierarchicalStrategy
    │   ├── peer-to-peer-strategy.ts    # PeerToPeerStrategy
    │   └── market-based-strategy.ts    # MarketBasedStrategy
    ├── goal/
    │   ├── distributed-goal-manager.ts # DistributedGoalManager 接口
    │   └── in-memory-distributed-goal-manager.ts
    ├── state/
    │   ├── shared-state-store.ts       # SharedStateStore 接口
    │   └── in-memory-shared-state.ts   # 基于 WorldStateGraph 的共享状态
    ├── lifecycle/
    │   ├── agent-lifecycle-manager.ts  # AgentLifecycleManager 接口
    │   └── default-lifecycle-manager.ts
    └── trace/
        └── distributed-tracer.ts       # 跨 Agent span 管理
```

### 1.2 包依赖关系

```
@neurocore/protocol           （类型定义 + 事件扩展）
     ▲
     │
@neurocore/world-model        （WorldStateGraph — M8 产出）
     ▲
     │
@neurocore/multi-agent        （依赖 protocol + world-model）
     ▲
     │
@neurocore/runtime-core       （CycleEngine delegate 分支集成）
     │
     ▼
@neurocore/runtime-server     （Agent 管理 API + 分布式 trace API）
```

关键约束：
- `multi-agent` 不依赖 `runtime-core`，只依赖 `protocol` 和 `world-model`
- `runtime-core` 通过依赖注入消费 `multi-agent` 提供的组件
- `multi-agent` 的消息总线为可插拔设计，`LocalInterAgentBus` 为默认同进程实现

---

## 2. 核心类设计

### 2.1 InMemoryAgentRegistry

```
InMemoryAgentRegistry
├── agents: Map<string, AgentDescriptor>    (instance_id → descriptor)
├── capabilityIndex: Map<string, Set<string>>  (capability_name → instance_ids)
├── domainIndex: Map<string, Set<string>>      (domain → instance_ids)
├── heartbeatMonitor: HeartbeatMonitor
├── statusCallbacks: Set<StatusChangeCallback>
├── eventBus: EventBus (注入)
│
├── register(descriptor)
│   └── 校验 instance_id 唯一
│       → 存入 agents Map
│       → 更新 capabilityIndex / domainIndex
│       → heartbeatMonitor.track(instance_id, heartbeat_interval_ms)
│       → emit agent.registered
│
├── deregister(instanceId)
│   └── 从 Map 移除
│       → 清理索引
│       → heartbeatMonitor.untrack(instanceId)
│       → emit agent.deregistered
│
├── heartbeat(instanceId)
│   └── 更新 descriptor.last_heartbeat_at
│       → heartbeatMonitor.touch(instanceId)
│       → 如果之前是 unreachable → 恢复为 idle/busy
│
├── discover(query)
│   └── 1. capabilities 过滤（通过 capabilityIndex 交集加速）
│       2. domains 过滤（通过 domainIndex 交集加速）
│       3. status 过滤
│       4. min_available_capacity 过滤 (max_capacity - current_load)
│       5. 返回 AgentDescriptor[]
│
├── get(instanceId)
│
├── listAll()
│
└── onStatusChange(callback)
```

### 2.2 HeartbeatMonitor

```
HeartbeatMonitor
├── tracked: Map<string, {
│     interval_ms: number;
│     last_seen: number;
│     miss_count: number;
│   }>
├── checkInterval: NodeJS.Timeout
├── onTimeout: (instanceId: string) => void
├── onRecovery: (instanceId: string) => void
│
├── track(instanceId, interval_ms)
├── untrack(instanceId)
├── touch(instanceId)
│   └── 重置 last_seen = Date.now(), miss_count = 0
├── start(checkFrequencyMs = 5000)
│   └── setInterval:
│       遍历 tracked
│       → elapsed > interval_ms → miss_count++
│       → miss_count === 1 → emit agent.heartbeat_lost
│       → miss_count >= 3 → onTimeout(instanceId)
└── stop()
```

设计要点：
- HeartbeatMonitor 独立于 AgentRegistry，便于单独测试
- 超时策略：1 次超时 emit 事件通知，3 次超时触发 terminated 转换
- `checkFrequencyMs` 默认 5s，远小于心跳间隔（默认 30s），确保及时检测

### 2.3 LocalInterAgentBus

```
LocalInterAgentBus
├── handlers: Map<string, MessageHandler>           (instance_id → handler)
├── topicSubscribers: Map<string, Set<{
│     instanceId: string;
│     handler: MessageHandler;
│   }>>
├── pendingRequests: Map<string, {                   (correlation_id → resolver)
│     resolve: (msg) => void;
│     reject: (err) => void;
│     timer: NodeJS.Timeout;
│   }>
├── streams: Map<string, StreamHandler>              (correlation_id → stream)
│
├── send(message)                                    [Request-Response]
│   └── 1. 创建 pendingRequest (correlation_id, timeout)
│       2. 查找 target handler
│       3. handler(message)
│       4. 等待 response（通过 pendingRequest resolve）
│       5. 超时 → reject(DelegationTimeoutError)
│
├── publish(topic, message)                          [Event Broadcast]
│   └── 1. 查找 topicSubscribers[topic]
│       2. 并行调用所有 subscriber.handler(message)
│       3. 单个 subscriber 失败不阻塞其他
│
├── subscribe(topic, handler)
│   └── 添加到 topicSubscribers[topic]
│       返回 unsubscribe 函数
│
├── openStream(targetInstanceId, correlationId)      [Stream]
│   └── 返回 { write(data), end() }
│       write → 构造 stream_data message → 递送到 target
│       end → 构造 stream_end message → 递送到 target
│
├── onStream(handler)
│   └── 注册 stream 接收回调
│
└── close()
    └── 清理所有 pending requests / subscriptions / streams
```

消息路由逻辑：
- **unicast**：`target_agent_id` 存在 → 直接路由到目标 handler
- **multicast**：`topic` 存在 → 查找 topic 订阅者列表
- **broadcast**：`topic` 存在且 `target_agent_id` 不存在 → 所有订阅者

### 2.4 TaskDelegator

```
TaskDelegator
├── registry: AgentRegistry
├── bus: InterAgentBus
├── strategies: {
│     capabilityBased: CapabilityBasedMatcher;
│     loadBalanced: LoadBalancedAssigner;
│     costAware: CostAwareSelector;
│   }
├── eventBus: EventBus
│
├── delegate(request: DelegationRequest)
│   └── emit delegation.requested
│       → switch (request.mode):
│
│       case "unicast":
│         └── 1. registry.get(target_agent_id)
│             2. 校验 agent 可用 (status === "idle" || capacity > 0)
│             3. bus.send(delegation request message)
│             4. 等待 response
│             5. emit delegation.accepted / delegation.rejected
│
│       case "broadcast":
│         └── 1. registry.discover(request.target_capabilities)
│             2. bus.publish("delegation.broadcast", request message)
│             3. 等待第一个 accept response（Promise.race + timeout）
│             4. 通知其他候选者取消
│             5. emit delegation.accepted / delegation.timeout
│
│       case "auction":
│         └── 1. registry.discover(request.target_capabilities)
│             2. emit auction.started
│             3. bus.publish("delegation.auction", request message)
│             4. 收集 bids（限时 auction_timeout_ms）
│             5. 对每个 bid emit auction.bid_received
│             6. 评分排序: score = f(duration, cost, confidence, weights)
│             7. 选择最高分 → emit auction.completed
│             8. bus.send(accept 给 winner / reject 给其他)
│             9. emit delegation.accepted
│
├── cancel(delegation_id)
│   └── bus.send(cancel message) → emit delegation.failed
│
├── getStatus(delegation_id)
│   └── 查询 delegation 状态
│
└── [内部] handleDelegationResult(response)
    └── 将 DelegationResponse.result 转换为 Observation
        → 回写到发起方的 CycleEngine
```

### 2.5 Delegation Strategies

```
CapabilityBasedMatcher
├── match(request, candidates: AgentDescriptor[])
│   └── 1. 过滤: agent.capabilities 包含 request.target_capabilities
│       2. 排序: 按 capability.proficiency 降序
│       3. 返回排序后列表

LoadBalancedAssigner
├── assign(request, candidates: AgentDescriptor[])
│   └── 1. 计算每个 agent 的 available_capacity = max_capacity - current_load
│       2. 过滤: available_capacity > 0
│       3. 排序: 按 available_capacity 降序
│       4. 返回第一个

CostAwareSelector
├── select(request, bids: AuctionBid[])
│   └── 1. 对每个 bid 计算综合分数:
│          score = w_d / duration + w_c / cost + w_f * confidence
│       2. 排序: 按 score 降序
│       3. 返回最高分 bid
```

### 2.6 CoordinationStrategy 实现

#### HierarchicalStrategy

```
HierarchicalStrategy
├── config: HierarchicalConfig
│
├── coordinate(ctx: CoordinationContext)
│   └── 1. 将 ctx.goal 分解为子任务列表
│          （调用 Reasoner.decomposeGoal 或按预设规则）
│       2. 按 config.worker_selection 策略分配:
│          - round_robin: 轮询分配
│          - least_loaded: 选负载最低的 agent
│          - best_fit: 按 capability proficiency 最匹配的
│       3. 生成 TaskAssignment[]
│       4. 返回 CoordinationResult
│
├── resolveConflict(ctx, conflicting_assignments)
│   └── Supervisor 裁决: 保留优先级最高的分配
```

#### PeerToPeerStrategy

```
PeerToPeerStrategy
├── config: PeerToPeerConfig
│
├── coordinate(ctx: CoordinationContext)
│   └── 1. initiator 提议分工方案
│       2. 通过 bus.publish 向所有参与者发起投票
│       3. 收集投票（限时 config.voting_timeout_ms）
│       4. 按 config.consensus_mode 判断是否达成共识:
│          - simple_majority: > 50%
│          - weighted_majority: 加权 > 50%
│          - unanimous: 100%
│       5. 达成 → 返回 CoordinationResult
│       6. 未达成 → 修改方案重新投票（最多 3 轮）
```

#### MarketBasedStrategy

```
MarketBasedStrategy
├── config: MarketBasedConfig
│
├── coordinate(ctx: CoordinationContext)
│   └── 1. 将 goal 分解为多个子任务
│       2. 对每个子任务发起 auction:
│          a. publish 招标消息
│          b. 收集 bids（限时 config.auction_timeout_ms）
│          c. 过滤: bid.estimated_cost <= config.reserve_price
│          d. 评分: w_d/duration + w_c/cost + w_f*confidence
│          e. 选择最高分 bidder
│       3. 聚合所有子任务的分配结果
│       4. 返回 CoordinationResult
```

### 2.7 InMemoryDistributedGoalManager

```
InMemoryDistributedGoalManager
├── assignments: Map<string, GoalAssignment>  (goal_id → assignment)
├── parentIndex: Map<string, Set<string>>     (parent_goal_id → child_goal_ids)
├── bus: InterAgentBus
├── goalManager: GoalManager (注入，现有)
│
├── decompose(parentGoalId, subGoals, strategy, agents)
│   └── 1. 构建 CoordinationContext
│       2. strategy.coordinate(ctx) → TaskAssignment[]
│       3. 对每个 assignment:
│          a. 创建子 Goal (goalManager.addGoal)
│          b. 记录 GoalAssignment (agent_id, instance_id)
│          c. 通过 bus.send 通知目标 Agent
│       4. 更新 parentIndex
│       5. 返回 GoalAssignment[]
│
├── updateStatus(goalId, status, progress)
│   └── 1. 更新 assignment 状态
│       2. 如果 status 是终态 (completed/failed):
│          a. 查找 parentIndex → 获取兄弟 goals
│          b. 聚合兄弟状态
│          c. 如果全部完成 → 传播父 Goal 状态为 completed
│          d. 如果有失败 → 根据策略决定父 Goal 状态
│       3. 通过 bus.publish("goal.progress", ...) 广播变更
│
├── reassign(goalId, newAgentId, newInstanceId)
│   └── 1. 取消原 agent 的任务 (bus.send cancel)
│       2. 更新 assignment
│       3. 通知新 agent (bus.send)
│
└── aggregateProgress(parentGoalId)
    └── 1. 获取所有子 goal assignments
        2. 计算 { total, completed, progress = completed/total }
```

### 2.8 DefaultAgentLifecycleManager

```
DefaultAgentLifecycleManager
├── registry: AgentRegistry
├── bus: InterAgentBus
├── goalManager: DistributedGoalManager
├── instances: Map<string, AgentInstanceInfo>
│
├── spawn(profile: AgentProfile, options?)
│   └── 1. 创建 AgentRuntime 实例
│       2. 生成 instance_id
│       3. 构建 AgentDescriptor
│       4. registry.register(descriptor)
│       5. 启动心跳定时器
│       6. 返回 instance_id
│
├── terminate(instanceId, force = false)
│   └── 1. if (!force) → drain(instanceId)
│       2. if (force) → 立即停止
│       3. registry.deregister(instanceId)
│       4. 清理资源
│
├── drain(instanceId)
│   └── 1. 设置状态 → draining
│       2. 拒绝新的 delegation 请求
│       3. 等待当前任务完成
│       4. 完成后 → terminate
│
├── pause(instanceId)
│   └── 暂停心跳 + 拒绝新任务
│
├── resume(instanceId)
│   └── 恢复心跳 + 接受新任务
│
└── handleHeartbeatTimeout(instanceId)
    └── 1. 标记 unreachable
        2. 获取该 agent 的未完成 goals
        3. 查找可用替代 agent
        4. goalManager.reassign(goalId, newAgentId, ...)
        5. emit agent.heartbeat_lost
```

---

## 3. 数据流时序

### 3.1 Delegate 动作执行流程

```
Agent A: CycleEngine.executeCycle()
  │
  ├── MetaDecision: { decision_type: "execute_action", selected_action_id: "act-1" }
  │   action_type: "delegate"
  │   tool_args: {
  │     delegation_mode: "auction",
  │     target_capabilities: ["data_analysis"],
  │     goal: { title: "分析用户数据", ... }
  │   }
  │
  ├── CycleEngine 识别 delegate action
  │
  ├── TaskDelegator.delegate(request)
  │   │
  │   ├── AgentRegistry.discover({ capabilities: ["data_analysis"] })
  │   │   └── 返回 [Agent B descriptor, Agent C descriptor]
  │   │
  │   ├── emit auction.started
  │   │
  │   ├── InterAgentBus.publish("delegation.auction", {
  │   │     delegation_id: "del-1",
  │   │     source_agent_id: "agent-a",
  │   │     mode: "auction",
  │   │     goal: { title: "分析用户数据", ... },
  │   │     timeout_ms: 10000
  │   │   })
  │   │
  │   ├── [等待 bids]
  │   │
  │   ├── Agent B 收到 → 评估自身能力 → 提交 bid:
  │   │   { agent_id: "agent-b", estimated_duration_ms: 5000, confidence: 0.9 }
  │   │   emit auction.bid_received
  │   │
  │   ├── Agent C 收到 → 评估自身能力 → 提交 bid:
  │   │   { agent_id: "agent-c", estimated_duration_ms: 3000, confidence: 0.7 }
  │   │   emit auction.bid_received
  │   │
  │   ├── 超时到达 → 评分:
  │   │   Agent B: score = 0.9 * 1.0 + 1.0 / 5.0 = 1.1
  │   │   Agent C: score = 0.7 * 1.0 + 1.0 / 3.0 = 1.03
  │   │   Winner: Agent B
  │   │
  │   ├── emit auction.completed
  │   │
  │   ├── bus.send(accept → Agent B)
  │   │   emit delegation.accepted
  │   │
  │   └── bus.send(reject → Agent C)
  │
  ├── [Agent B 执行任务]
  │   ├── 创建 Session
  │   ├── 设置 Goal
  │   ├── 运行 CycleEngine
  │   ├── 完成 → 生成 DelegationResponse
  │   └── bus.send(response → Agent A)
  │       emit delegation.completed
  │
  └── Agent A 接收结果
      ├── DelegationResponse.result → 转换为 Observation
      │   Observation.source_type = "runtime"
      │   Observation.structured_payload = response.result.payload
      │   Observation.summary = response.result.summary
      └── 写入当前 Cycle → 继续后续流程
```

### 3.2 层级式协调流程

```
Supervisor Agent
  │
  ├── 收到顶层 Goal: "完成客户报告"
  │
  ├── Reasoner.decomposeGoal() → 3 个子 Goal:
  │   ├── "数据收集" (priority: 3)
  │   ├── "数据分析" (priority: 2, 依赖 "数据收集")
  │   └── "报告撰写" (priority: 1, 依赖 "数据分析")
  │
  ├── HierarchicalStrategy.coordinate()
  │   │
  │   ├── AgentRegistry.discover() → [Worker A, Worker B, Worker C]
  │   │
  │   ├── worker_selection = "best_fit":
  │   │   Worker A: capabilities=["data_collection"] → 分配 "数据收集"
  │   │   Worker B: capabilities=["data_analysis"]   → 分配 "数据分析"
  │   │   Worker C: capabilities=["report_writing"]  → 分配 "报告撰写"
  │   │
  │   └── 返回 CoordinationResult { assignments: [...] }
  │
  ├── DistributedGoalManager.decompose()
  │   ├── 创建 3 个子 Goal (goalManager.addGoal)
  │   ├── 通过 bus.send 通知各 Worker
  │   └── 记录 GoalAssignment
  │
  ├── [Worker A 执行 "数据收集"]
  │   └── 完成 → goalManager.updateStatus("数据收集", "completed")
  │       → 状态传播 → 检查依赖 → "数据分析" 解除阻塞
  │       → bus.publish("goal.progress", ...)
  │
  ├── [Worker B 执行 "数据分析"]
  │   └── 完成 → goalManager.updateStatus("数据分析", "completed")
  │       → "报告撰写" 解除阻塞
  │
  ├── [Worker C 执行 "报告撰写"]
  │   └── 完成 → goalManager.updateStatus("报告撰写", "completed")
  │
  └── goalManager.aggregateProgress("顶层 Goal")
      └── { total: 3, completed: 3, progress: 1.0 }
          → 顶层 Goal 标记 completed
```

### 3.3 共享世界状态同步

```
Agent A 修改 WorldStateGraph
  │
  ├── worldStateGraph.applyPercepts(percepts)
  │   └── 返回 WorldStateDiff
  │
  ├── SharedStateStore.applyDiff(diff, version_vector)
  │   │
  │   ├── 检查 version vector → 无冲突
  │   │   └── 应用 diff → 递增 version
  │   │
  │   ├── 或: 检查 version vector → 冲突
  │   │   └── emit world_state.conflict_detected
  │   │       → last-writer-wins 解决
  │   │       → emit world_state.conflict_resolved
  │   │
  │   └── bus.publish("world.state_changed", {
  │         agent_id: "agent-a",
  │         diff: WorldStateDiff,
  │         version: 42
  │       })
  │
  └── Agent B 收到 world.state_changed
      ├── 校验 version → 应用 diff 到本地 WorldStateGraph
      └── 下次 cycle 的 WorkspaceSnapshot.world_state_digest 反映最新状态
```

---

## 4. 与现有模块的集成方式

### 4.1 AgentRuntime 注入点

```typescript
interface AgentRuntimeOptions {
  // ... 现有选项 ...
  agentRegistry?: AgentRegistry;
  interAgentBus?: InterAgentBus;
  taskDelegator?: TaskDelegator;
  distributedGoalManager?: DistributedGoalManager;
  agentLifecycleManager?: AgentLifecycleManager;
  sharedStateStore?: SharedStateStore;
  coordinationStrategy?: CoordinationStrategy;
}
```

向后兼容策略：
- 所有多 Agent 注入项为可选
- 未注入时，`ActionType.delegate` 的 CandidateAction 在 MetaController 阶段被过滤（选择非 delegate 动作）
- 单 Agent 模式下完全不触发任何多 Agent 逻辑

### 4.2 CycleEngine 改动范围

```
CycleEngine 改动点:
│
├── act 阶段新增 delegate 分支:
│   ├── if (action.action_type === "delegate" && taskDelegator)
│   │   ├── 构建 DelegationRequest（从 action.tool_args 提取参数）
│   │   ├── taskDelegator.delegate(request)
│   │   ├── 等待 DelegationResponse
│   │   └── 将 response.result 转换为 Observation
│   │
│   └── if (action.action_type === "delegate" && !taskDelegator)
│       └── 生成失败 Observation: "delegate 不可用，未配置多 Agent 运行时"
│
├── workspace 构建阶段:
│   └── if (agentRegistry)
│       └── WorkspaceSnapshot 中注入可用 Agent 列表摘要
│           → Reasoner 可据此生成 delegate 类型的 CandidateAction
│
└── goal 管理:
    └── if (distributedGoalManager)
        └── Goal 状态变更通过 distributedGoalManager.updateStatus() 广播
```

### 4.3 Reasoner 感知多 Agent

```
ModuleContext 扩展:
│
├── 新增可选字段:
│   available_agents?: AgentDescriptor[]
│
└── CycleEngine 在构建 ModuleContext 时:
    if (agentRegistry)
      ctx.available_agents = await agentRegistry.discover({
        status: ["idle"],
        min_available_capacity: 1
      })
```

Reasoner 据此决定是否生成 `ActionType.delegate` 的 CandidateAction：
- 如果 `available_agents` 存在且任务可分解 → 生成 delegate action
- 如果 `available_agents` 为空 → 只生成本地执行 action

### 4.4 事件注册

在 `protocol/src/events.ts` 中扩展 `NeuroCoreEventType`：

```typescript
export type NeuroCoreEventType =
  // ... 现有 18 种 + M8 的 7 种 ...
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

---

## 5. 配置设计

### 5.1 AgentProfile 扩展

```typescript
interface AgentProfile {
  // ... 现有字段 ...
  multi_agent_config?: MultiAgentConfig;
}

interface MultiAgentConfig {
  enabled: boolean;                              // 默认 false
  heartbeat_interval_ms?: number;                // 默认 30000
  heartbeat_timeout_multiplier?: number;         // 默认 1.5（即 45s 超时）
  heartbeat_max_misses?: number;                 // 默认 3
  delegation_timeout_ms?: number;                // 默认 60000
  auction_timeout_ms?: number;                   // 默认 10000
  max_delegation_depth?: number;                 // 默认 3
  coordination_strategy?: "hierarchical" | "peer_to_peer" | "market_based";  // 默认 hierarchical
  capabilities?: AgentCapability[];              // 本 Agent 声明的能力
  domains?: string[];                            // 本 Agent 的领域标签
  max_capacity?: number;                         // 最大并发任务数，默认 5
  auto_accept_delegation?: boolean;              // 自动接受委派，默认 true
  shared_state_config?: {
    sync_mode: "push" | "pull" | "bidirectional";  // 默认 bidirectional
    namespaces?: string[];                         // 关注的 namespace 列表
    conflict_resolution: "last_writer_wins" | "merge";  // 默认 last_writer_wins
  };
}
```

### 5.2 协调策略配置

```typescript
interface HierarchicalConfig {
  max_tree_depth: number;                        // 默认 3
  worker_selection: "round_robin" | "least_loaded" | "best_fit";  // 默认 best_fit
  result_aggregation: "all_success" | "majority" | "any_success"; // 默认 all_success
}

interface PeerToPeerConfig {
  consensus_mode: "simple_majority" | "weighted_majority" | "unanimous";  // 默认 simple_majority
  voting_timeout_ms: number;                     // 默认 10000
  max_voting_rounds: number;                     // 默认 3
  agent_weights?: Record<string, number>;
}

interface MarketBasedConfig {
  auction_timeout_ms: number;                    // 默认 10000
  min_bids: number;                              // 默认 1
  scoring_weights: {
    duration: number;                            // 默认 0.3
    cost: number;                                // 默认 0.3
    confidence: number;                          // 默认 0.4
  };
  reserve_price?: number;
}
```

---

## 6. 错误处理策略

### 6.1 委派错误

| 场景 | 处理方式 |
|---|---|
| 目标 Agent 不可用 | unicast 模式：立即失败返回 rejected；broadcast/auction 模式：跳过该 agent |
| 委派超时 | 返回 `DelegationResponse { status: "timeout" }`，CycleEngine 将其转为失败 Observation |
| 竞标无人投标 | 返回 timeout，CycleEngine 可选择回退到本地执行 |
| 嵌套深度超限 | 检查 `current_depth >= max_depth` → 直接拒绝，不继续委派 |
| 目标 Agent 执行失败 | 返回 `DelegationResponse { status: "failed" }`，记录错误原因 |
| 重复委派（幂等） | 检查 delegation_id → 如已存在且状态为 completed → 直接返回缓存结果 |

### 6.2 通信错误

| 场景 | 处理方式 |
|---|---|
| `bus.send()` 目标 handler 不存在 | 抛出 `AgentNotFoundError`，由 TaskDelegator 捕获并返回 rejected |
| `bus.send()` handler 抛出异常 | 包装为 error response 返回给发送方 |
| `bus.publish()` 部分 subscriber 失败 | 记录日志，不影响其他 subscriber 接收 |
| 消息 TTL 过期 | 丢弃消息，如果是 request → 触发发送方的 timeout |

### 6.3 生命周期错误

| 场景 | 处理方式 |
|---|---|
| Agent 心跳超时 | 1 次: emit 事件通知；3 次: 标记 terminated + 重新分配任务 |
| drain 期间新任务到达 | 拒绝新委派，返回 `{ status: "rejected", reason: "agent_draining" }` |
| Agent 异常终止（未优雅退出） | HeartbeatMonitor 检测到 → 重新分配未完成任务 |
| 重新分配的任务再次失败 | 升级通知 Supervisor 或发起方，不自动重试 |

### 6.4 世界状态冲突

| 场景 | 处理方式 |
|---|---|
| 并发写入同一 entity | last-writer-wins（基于 version vector 比较） |
| version vector 分叉 | emit `world_state.conflict_detected` → 按策略合并或取最新 |
| namespace 隔离违规 | 拒绝写入非声明 namespace 的状态 |

---

## 7. 实现顺序

按依赖关系从基础设施向上推进：

```
Phase 1 (M9.1): AgentRegistry + HeartbeatMonitor
  ├── 定义 AgentDescriptor / AgentStatus / AgentCapability 类型
  ├── 实现 InMemoryAgentRegistry
  ├── 实现 HeartbeatMonitor
  └── 单元测试: 注册/注销/发现/心跳/能力查询

Phase 2 (M9.4): InterAgentBus
  ├── 定义 InterAgentMessage / MessagePattern 类型
  ├── 实现 LocalInterAgentBus
  ├── 实现 MessageRouter
  └── 单元测试: send/publish/subscribe/stream/timeout

Phase 3 (M9.2): TaskDelegator + DelegationStrategies
  ├── 依赖 Phase 1 (Registry) + Phase 2 (Bus)
  ├── 实现 TaskDelegator (unicast/broadcast/auction)
  ├── 实现 CapabilityBasedMatcher / LoadBalancedAssigner / CostAwareSelector
  ├── 实现 AuctionManager
  └── 单元测试: 三种模式 / 超时 / 嵌套 / 取消 / 策略选择

Phase 4 (M9.3): CoordinationStrategies
  ├── 依赖 Phase 1 + Phase 2 + Phase 3
  ├── 实现 HierarchicalStrategy
  ├── 实现 PeerToPeerStrategy
  ├── 实现 MarketBasedStrategy
  └── 单元测试: 各策略的分配行为

Phase 5 (M9.5): DistributedGoalManager
  ├── 依赖 Phase 2 (Bus) + Phase 4 (Coordination)
  ├── 实现 InMemoryDistributedGoalManager
  └── 单元测试: decompose / updateStatus / 状态传播 / reassign

Phase 6 (M9.7): SharedStateStore
  ├── 依赖 Phase 2 (Bus) + M8 WorldStateGraph
  ├── 实现 InMemorySharedStateStore
  └── 单元测试: 并发写入 / 冲突解决 / namespace 隔离

Phase 7 (M9.8): AgentLifecycleManager
  ├── 依赖 Phase 1 (Registry) + Phase 2 (Bus) + Phase 5 (GoalManager)
  ├── 实现 DefaultAgentLifecycleManager
  └── 单元测试: spawn / terminate / drain / pause / resume / 故障恢复

Phase 8 (M9.9): 集成与回归
  ├── CycleEngine delegate 分支集成
  ├── AgentRuntime 注入
  ├── ModuleContext 扩展
  ├── 事件注册
  ├── 全量回归测试
  └── 端到端测试: Supervisor → 分解 → Worker 执行 → 结果汇总
```

---

## 8. 测试策略

### 8.1 单元测试

| 模块 | 测试文件 | 关键场景 |
|---|---|---|
| InMemoryAgentRegistry | `agent-registry.test.ts` | 注册/注销/发现；capabilityIndex 加速查询；重复注册报错；状态变更回调 |
| HeartbeatMonitor | `heartbeat-monitor.test.ts` | touch 重置计时；超时 miss_count 递增；3 次超时触发 onTimeout；恢复后 miss_count 重置 |
| LocalInterAgentBus | `local-bus.test.ts` | send → handler → response 闭环；publish → 多 subscriber 接收；subscribe/unsubscribe；send 超时 → reject；stream 数据传输 + end 信号 |
| TaskDelegator | `task-delegator.test.ts` | unicast 成功/失败；broadcast 第一个接受者胜出；auction 评分排序正确；超时回退；嵌套深度限制；cancel 中止 |
| CapabilityBasedMatcher | `delegation-strategies.test.ts` | 按 proficiency 排序；无匹配返回空；多能力交集过滤 |
| LoadBalancedAssigner | `delegation-strategies.test.ts` | 选负载最低的；capacity 满的被过滤 |
| CostAwareSelector | `delegation-strategies.test.ts` | 按综合分数排序；权重配置影响排序 |
| HierarchicalStrategy | `hierarchical.test.ts` | 任务分解 + 分配；round_robin / least_loaded / best_fit 选择 |
| PeerToPeerStrategy | `peer-to-peer.test.ts` | 投票达成共识；投票超时；加权投票 |
| MarketBasedStrategy | `market-based.test.ts` | 竞标 + 评分 + 选择；无投标超时；reserve_price 过滤 |
| DistributedGoalManager | `distributed-goal.test.ts` | decompose 创建子 Goal；状态传播到父 Goal；reassign 重新分配；aggregateProgress 统计 |
| SharedStateStore | `shared-state.test.ts` | 写入 + 广播；并发写入冲突；version vector 比较；namespace 隔离 |
| AgentLifecycleManager | `lifecycle.test.ts` | spawn → register → idle；drain → 不接受新任务 → terminated；心跳超时 → 重新分配 |

### 8.2 集成测试

| 场景 | 验证点 |
|---|---|
| Unicast 委派闭环 | Agent A delegate → Agent B 执行 → 结果回写 Agent A Observation |
| Auction 竞标闭环 | 发布竞标 → 多 Agent 投标 → 评分选择 → Winner 执行 → 结果返回 |
| 层级式协调 E2E | Supervisor 分解 Goal → Worker A/B/C 并行执行 → 全部完成 → 顶层 Goal completed |
| 故障恢复 E2E | Agent B 心跳超时 → 任务重新分配给 Agent C → Agent C 完成 |
| 共享状态同步 | Agent A 更新 WorldStateGraph → Agent B 收到变更通知 → 本地状态一致 |
| 嵌套委派 | Agent A → Agent B → Agent C (depth=2) → 结果逐层返回 |
| 嵌套超限 | Agent A → B → C → D (depth=3) → D 拒绝继续委派 |

### 8.3 回归测试

- 不注入多 Agent 组件时，现有 132+ 测试全部通过
- `ActionType.delegate` 的 CandidateAction 在无 TaskDelegator 时被安全过滤
- `tsc --noEmit` 通过
- 新包构建通过

---

## 9. 关键设计决策

### 9.1 消息总线：同进程优先

| 考量 | 决策 |
|---|---|
| 初始场景 | 单机多 Agent（同一 Node.js 进程内多个 AgentRuntime 实例） |
| 实现复杂度 | `LocalInterAgentBus` 用 Map + 回调实现，零网络开销 |
| 扩展路径 | InterAgentBus 接口不变，后续可实现 `RedisInterAgentBus` / `NatsInterAgentBus` |
| 测试便利 | 同进程 Bus 支持确定性测试，无需 mock 网络层 |

### 9.2 AgentRegistry：中心化 vs 去中心化

采用 **中心化注册中心** 模式：
- 简单可靠，适合初始阶段
- 所有 Agent 向同一个 Registry 注册
- 去中心化（gossip / DHT）作为未来可选升级路径
- Registry 本身是接口，后续可替换为分布式实现

### 9.3 委派模式：三种模式的适用场景

| 模式 | 适用场景 | 开销 |
|---|---|---|
| unicast | 已知目标 Agent，如指定专家处理 | 最低：1 次消息 |
| broadcast | 不确定谁最合适，取第一个响应者 | 中等：N 次消息 |
| auction | 需要最优选择，多个候选者竞争 | 最高：N 次消息 + 等待期 |

默认推荐 unicast（最简单可预测），当 Reasoner 不确定目标时使用 broadcast。

### 9.4 Goal 状态传播策略

采用 **自底向上传播 + 策略可配**：
- 所有子 Goal completed → 父 Goal completed（默认 `all_success`）
- 超过半数 completed → 父 Goal completed（`majority`）
- 任一子 Goal completed → 父 Goal completed（`any_success`）
- 任一子 Goal failed → 父 Goal blocked（等待 Supervisor 决策）

### 9.5 world_state 冲突解决

采用 **last-writer-wins + version vector** 策略：
- 简单且无死锁风险
- version vector 检测并发写入
- 冲突时 emit 事件通知，由上层（Supervisor 或 MetaController）决定是否干预
- 未来可升级为 CRDT（Conflict-free Replicated Data Types）

---

## 10. 构建与发布

### 10.1 package.json

```json
{
  "name": "@neurocore/multi-agent",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "node --test dist/**/*.test.js"
  },
  "dependencies": {
    "@neurocore/protocol": "workspace:*",
    "@neurocore/world-model": "workspace:*"
  }
}
```

### 10.2 tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../protocol" },
    { "path": "../world-model" }
  ]
}
```

### 10.3 根 tsconfig 更新

```json
// tsconfig.json (根)
{
  "references": [
    // ... 现有包 ...
    { "path": "packages/device-core" },
    { "path": "packages/world-model" },
    { "path": "packages/multi-agent" }
  ]
}
```
