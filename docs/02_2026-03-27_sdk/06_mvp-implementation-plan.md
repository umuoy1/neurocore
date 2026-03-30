# NeuroCore Agent SDK MVP 实施计划

## 1. 文档目标

本文档给出从当前设计方案到第一版可运行产品的实施路径，目标是把“需求、设计、架构”继续推进为“可排期、可拆分、可验收”的实施计划。

本文档重点回答：

1. MVP 到底做哪些东西
2. 按什么顺序做
3. 每一阶段的交付物是什么
4. 如何验收
5. 哪些风险需要提前锁定

## 2. MVP 定义

NeuroCore Agent SDK 的 MVP，不是“完整新范式的所有能力”，而是一个满足以下条件的最小可用内核：

1. 开发者可以定义 Agent
2. Session 可以创建、恢复、完成
3. Runtime 可以执行标准认知周期
4. Agent 可以使用目标栈、工具、工作记忆和情景记忆
5. 高风险动作有基础门控
6. 运行过程可追踪、可回放、可评估

MVP 不要求：

- 强世界模型训练
- 自动技能提炼闭环
- 多 Agent 协作网络
- 全量企业控制台

## 3. 实施原则

### 3.1 先内核，后能力增强

先把状态模型、运行时和协议做稳，再往上叠加世界模型、技能学习和复杂控制面。

### 3.2 先可观测，后优化

没有 Trace、Replay 和 Eval，就没有可靠迭代。观测能力必须从第一阶段进入核心。

### 3.3 先规则门控，后智能门控

元认知和风险控制在首版中可以先采用规则、阈值和轻量评分，不必等待复杂学习系统。

### 3.4 先单 Agent，后多 Agent

单 Agent 的状态机、恢复、门控和评估没跑稳之前，不应该扩展复杂委托系统。

## 4. MVP 交付范围

### 4.1 必须交付

- Protocol Schema
- Agent Builder
- Session Runtime
- Goal Stack
- Workspace Snapshot
- Tool Gateway
- Working Memory
- Episodic Memory
- Meta Controller
- Trace Store
- Replay Runner
- Eval Harness

### 4.2 可选交付

- 规则型 Predictor
- 静态 Skill Registry
- Runtime HTTP API

### 4.3 明确不做

- 语义记忆自动巩固
- 技能自动提炼
- 高保真世界状态图
- 多租户运营后台
- 多 Agent 分布式调度

## 5. 里程碑拆分

建议拆分为六个阶段。

### Milestone 0: 基础仓库与协议冻结

目标：

- 建立后续所有实现的公共协议与仓库骨架

交付物：

- `packages/protocol`
- Schema 定义
- JSON Schema / OpenAPI 生成流程
- 基础 lint、test、build 流程
- 示例 fixtures

验收标准：

- 所有核心对象具备稳定类型定义
- 协议可自动生成并被其他包消费
- 示例 Session 数据可通过 Schema 校验

### Milestone 1: Runtime Core 最小闭环

目标：

- 让单个 Agent Session 能在本地完成最基本运行闭环

交付物：

- `runtime-core`
- Session 生命周期管理
- Goal Stack
- 基础 Cognitive Cycle
- Workspace Coordinator
- Mock Reasoner
- Mock Tool Gateway

验收标准：

- 能创建 Session
- 能执行至少 3 个周期
- 能在工具结果返回后继续运行
- 能正常结束为 `completed` 或 `failed`

### Milestone 2: 工具、记忆与门控

目标：

- 让 Agent 具备最小实用性和安全性

交付物：

- Working Memory
- Episodic Memory
- Tool SPI + Tool Registry
- PolicyProvider
- Meta Controller
- 基础 Approval 流程

验收标准：

- Agent 能检索并使用历史 Episode
- 高风险工具动作可被拦截或审批
- 工具超时、失败、重试路径可追踪

### Milestone 3: Trace、Replay、Eval

目标：

- 让系统可调试、可回放、可基准比较

交付物：

- CycleTrace
- Session 事件流
- Replay Runner
- Eval Harness
- 基线任务集

验收标准：

- 任意 Session 可回放
- 能对比两个 Agent/Profile 版本的结果差异
- 能输出基础评估报告

### Milestone 4: SDK 与 Runtime Server

目标：

- 让外部开发者可集成，让内部平台可托管

交付物：

- `sdk-core`
- `runtime-server`
- Session API
- Trace API
- Approval API

验收标准：

- 本地 SDK 与远程 Runtime 的调用语义基本一致
- 一个示例项目可通过 SDK 和托管 Runtime 两种方式运行

### Milestone 5: 可选增强

目标：

- 在不破坏 MVP 核心边界的前提下，增强可用性

候选交付物：

- 规则型 Predictor
- 静态 Skill Registry
- Node 环境工具适配器
- 最小可视化 Console

## 6. 工作分解结构

### 6.1 Protocol Track

任务：

- 定义核心 Schema
- 定义事件协议
- 定义命令协议
- 定义 JSON Schema 生成
- 定义版本策略

产物：

- `protocol` 包
- 协议文档
- 示例数据

### 6.2 Runtime Track

任务：

- Session 状态机
- Goal Tree 状态机
- Cycle Scheduler
- Workspace Coordinator
- Action Executor
- Checkpoint

产物：

- `runtime-core`

### 6.3 Safety & Policy Track

任务：

- Tool Policy
- Budget Policy
- Approval Policy
- Output Policy
- 基础冲突检测

产物：

- `policy-core`

### 6.4 Memory Track

任务：

- Working Memory
- Episodic Memory
- 检索策略
- Episode Writer

产物：

- `memory-core`

### 6.5 Developer Experience Track

任务：

- Agent Builder
- Runtime Client
- CLI
- 示例工程

产物：

- `sdk-core`
- `cli`
- `examples`

### 6.6 Evaluation Track

任务：

- Trace Store
- Replay
- Eval Harness
- 基准样例

产物：

- `eval-core`

## 7. 建议时间规划

如果按 4 到 6 人核心团队推进，建议按 10 到 14 周规划首版。

### 第 1-2 周

- 冻结协议
- 初始化 Monorepo
- 建立 CI、Schema 生成和测试基建

### 第 3-5 周

- 完成 Runtime Core 最小闭环
- 完成 Goal/Session/Cycle 基础能力

### 第 6-8 周

- 接入 Tool Gateway、Memory、Policy、Meta Controller
- 跑通一个完整可用示例

### 第 9-10 周

- 完成 Trace、Replay、Eval
- 建立第一版基线任务集

### 第 11-12 周

- 完成 SDK 封装和 Runtime Server
- 做文档、示例和对外 API 整理

### 第 13-14 周

- 稳定性修复
- 压测
- 版本冻结和发布准备

## 8. 建议团队分工

### 8.1 平台架构负责人

负责：

- 协议冻结
- Runtime 边界
- 关键设计决策

### 8.2 Runtime 工程师

负责：

- Session、Goal、Cycle、Workspace、Execution

### 8.3 安全与策略工程师

负责：

- Policy、审批、预算、输出门控

### 8.4 SDK / DX 工程师

负责：

- SDK、CLI、模板项目、开发者体验

### 8.5 评估与质量工程师

负责：

- Trace、Replay、Eval、基线和回归验证

## 9. MVP 验收场景

建议至少以以下 5 类场景作为验收集。

### 9.1 复杂问答 + 澄清

要求：

- Agent 能识别信息缺口
- 能提出澄清问题
- 能在补充信息后继续执行

### 9.2 多工具串联任务

要求：

- Agent 能在多个工具间切换
- 能处理部分失败
- 能记录完整 Trace

### 9.3 高风险工具审批

要求：

- 写操作需要审批
- 审批后才能继续执行

### 9.4 长任务恢复

要求：

- 中断后可从检查点恢复
- 恢复后 Goal 与 Workspace 一致

### 9.5 经验复用

要求：

- 第二次相似任务能召回历史 Episode
- 回放中可看到记忆参与决策

## 10. 关键验收指标

### 10.1 功能指标

- Session 生命周期完整通过率
- Goal 状态流转正确率
- Tool Gateway 成功接入率
- 审批流程正确率
- Replay 可用率

### 10.2 质量指标

- 单任务崩溃率
- Session 恢复成功率
- Trace 完整率
- 评估回归发现率

### 10.3 成本指标

- 单任务平均周期数
- 平均 Token 消耗
- 平均工具调用数

## 11. 风险清单

### 11.1 设计风险

- 协议过早膨胀，导致实现成本飙升
- 核心对象定义不清，导致后续反复返工

### 11.2 工程风险

- Runtime 状态机实现复杂，恢复逻辑易错
- 工具和审批流耦合不当，导致执行路径混乱

### 11.3 产品风险

- MVP 过于底层，缺乏一个清晰示例对外展示价值
- 只做理论映射，没有做出明显优于 ReAct 的工程收益

## 12. 降险措施

1. 先锁协议，再写 Runtime。
2. 先做单机最小闭环，再做服务化。
3. 先做 2-3 个强场景样例，再扩展泛化能力。
4. 先确保 Trace/Replay 完整，再追求算法增强。
5. 所有增强能力都通过 SPI 接入，不侵入 Runtime Core。

## 13. 第一批代码文件建议

建议最先创建以下文件和目录：

```text
packages/protocol/src/types.ts
packages/protocol/src/events.ts
packages/protocol/src/commands.ts
packages/runtime-core/src/session/session-manager.ts
packages/runtime-core/src/goal/goal-manager.ts
packages/runtime-core/src/cycle/cycle-engine.ts
packages/runtime-core/src/workspace/workspace-coordinator.ts
packages/runtime-core/src/meta/meta-controller.ts
packages/runtime-core/src/execution/tool-gateway.ts
packages/memory-core/src/working-memory.ts
packages/memory-core/src/episodic-memory.ts
packages/sdk-core/src/define-agent.ts
packages/sdk-core/src/session-handle.ts
packages/eval-core/src/replay-runner.ts
packages/eval-core/src/eval-runner.ts
```

## 14. 结论

NeuroCore 的 MVP 实施关键不在于“做多少高级能力”，而在于先把以下闭环做成：

- 协议闭环
- 状态闭环
- 执行闭环
- 门控闭环
- 观测闭环

这五个闭环一旦成型，后续无论是世界模型、技能学习还是多 Agent，都可以在稳定底座上迭代，而不会把系统再次拖回“复杂 prompt 编排器”的老路。
