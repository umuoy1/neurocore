# M9: 多 Agent 分布式调度

> 方向 A · FR-28 ~ FR-35
> 详细设计: [02_multi-agent-scheduling.md](../02_multi-agent-scheduling.md)
> 依赖: M8 (WorldStateGraph 作为共享世界状态)
> 目标: 整体架构新增"多 Agent 层"
> 状态: ⬜

---

## M9.1 Agent Registry (FR-28) — P0

- [ ] 定义 `AgentDescriptor` 接口: agent_id / capabilities / status / heartbeat
- [ ] 定义 `AgentRegistry` SPI: register / unregister / discover / heartbeat
- [ ] 实现 `InMemoryAgentRegistry`
- [ ] 心跳检测: 定期检查在线状态，超时标记 offline
- [ ] 能力查询: 按 capability / domain / status 过滤
- [ ] emit `agent.registered` / `agent.unregistered` / `agent.heartbeat.timeout` 事件
- [ ] 单元测试: 注册/注销/发现/心跳/能力查询

## M9.2 Task Delegation (FR-29) — P0

- [ ] 定义 `DelegationRequest` / `DelegationResponse` / `DelegationResult` 接口
- [ ] 定义 `TaskDelegator` SPI: delegate / cancel / getStatus
- [ ] 三种委派模式: unicast / broadcast / auction
- [ ] 超时和重试机制
- [ ] 嵌套委派支持 (max_depth=3)
- [ ] 单元测试: 三种模式 / 超时 / 嵌套 / 取消

## M9.3 Delegation Strategies (FR-30) — P1

- [ ] `CapabilityBasedMatcher`: 按 capability 集合匹配
- [ ] `LoadBalancedAssigner`: 按当前负载分配
- [ ] `CostAwareSelector`: 按预估 token/cost 选择
- [ ] 策略可配置切换
- [ ] 单元测试: 各策略的选择行为

## M9.4 Inter-Agent Bus (FR-31) — P0

- [ ] 定义 `InterAgentMessage` 接口: sender / recipient / type / payload
- [ ] 定义 `InterAgentBus` SPI: send / broadcast / subscribe / unsubscribe
- [ ] 实现 `LocalInterAgentBus` (同进程)
- [ ] 消息类型: request / response / notification / error
- [ ] 消息路由: unicast / multicast / broadcast
- [ ] 单元测试: 点对点 / 广播 / 订阅取消 / 错误传播

## M9.5 Shared Goal Management (FR-32) — P1

- [ ] 定义 `DistributedGoalManager` 接口
- [ ] 跨 Agent 的 Goal 树共享和同步
- [ ] 子 Goal 状态变更自动向上传播
- [ ] Goal 冲突检测（多个 Agent 试图修改同一 Goal）
- [ ] 单元测试: Goal 分配 / 状态传播 / 冲突解决

## M9.6 Coordination Protocols (FR-33) — P1

- [ ] 层级式协调: Supervisor → Worker 分配
- [ ] 对等式协调: Agent 间平等协商
- [ ] 市场式协调: 竞标 + 拍卖
- [ ] 协调策略可配置
- [ ] 单元测试: 各协议的行为

## M9.7 State Synchronization (FR-34) — P1

- [ ] 定义 `SharedStateStore` 接口
- [ ] Agent 间的世界状态同步（基于 M8 WorldStateGraph）
- [ ] 状态版本和冲突解决 (last-write-wins / CRDT)
- [ ] 单元测试: 并发写入 / 冲突解决

## M9.8 Agent Lifecycle (FR-35) — P0

- [ ] 定义 `AgentLifecycleManager`: spawn / terminate / pause / resume
- [ ] Agent 进程管理（子进程 / Docker / 远程）
- [ ] 资源隔离和限制
- [ ] 优雅关闭和状态保存
- [ ] 单元测试: 生命周期状态转换

## M9.9 Integration & Regression

- [ ] 新增事件注册到 `NeuroCoreEventType`
- [ ] 新包 `@neurocore/multi-agent` 构建通过
- [ ] 现有 132+ 测试全部通过（回归）
- [ ] `tsc --noEmit` 通过
- [ ] 端到端测试: Supervisor 分解任务 → Worker 执行 → 结果汇总

---

## Acceptance Criteria

| # | 条件 |
|---|
| AC-1 | AgentRegistry 支持注册/发现/心跳，离线 Agent 自动标记 |
| AC-2 | TaskDelegator 支持三种委派模式，超时自动降级 |
| AC-3 | InterAgentBus 支持点对点和广播通信 |
| AC-4 | 至少两种协调策略（层级式 + 市场式）可运行 |
| AC-5 | 端到端: 主 Agent 分解任务 → 2+ 子 Agent 并行执行 → 结果汇总 |
