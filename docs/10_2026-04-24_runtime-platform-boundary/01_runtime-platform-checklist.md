# NeuroCore 平台必须实现的能力清单

> 日期：2026-04-24
>
> 目标：明确为了支撑“可长期运行、可自主行动、可派发任务、可承载超级助理产品”的目标，哪些能力必须由 `NeuroCore` 运行时平台承担。

## 1. 判断原则

以下能力应由 `NeuroCore` 实现，而不是下沉到具体个人助理产品中：

- 任何通用 Agent 产品都会复用的能力
- 任何需要统一协议、统一治理、统一调度的能力
- 任何会影响运行时正确性、安全性、恢复性与可观测性的能力
- 任何需要通过 SPI、Server、SDK、Snapshot、Replay、Eval 统一暴露的能力

不满足以上条件、且高度依赖具体业务场景的能力，应在个人助理产品层实现。

## 2. 运行时主链能力

### 2.1 长期运行时

- 常驻运行模型
- 定时唤醒
- 外部事件驱动唤醒
- 后台任务调度
- 长时 agenda 管理
- checkpoint / restore / recovery
- 长期任务暂停 / 恢复 / 重排 / 放弃

### 2.2 Session / Goal / Cycle 核心状态机

- 长生命周期 session 管理
- goal tree 与长期目标状态维护
- cycle 编排与中断恢复
- action / observation 生命周期
- 多轮会话连续状态保持
- 长对话摘要与上下文裁剪

### 2.3 执行平面

- tool execution 主链
- parallel tools
- delegate / sub-session 闭环
- conditional planning / DAG plan 执行
- tool cache / idempotency
- long-running action 跟踪

## 3. 长期记忆与检索能力

### 3.1 记忆主链

- working / episodic / semantic / procedural 四层记忆
- 写入、召回、巩固、恢复、清理
- snapshot / checkpoint / SQL-first 持久化

### 3.2 长期记忆演进

- 更强检索后端
- 长期 schema 演进
- 长期 benchmark 与回归
- 记忆压缩与长期连续性治理
- 跨 session / 跨项目的长期状态保持

## 4. 自主能力底座

### 4.1 自治状态与规划

- autonomy state
- autonomous planner
- long-horizon plan store
- plan revision / recovery
- 自治状态进入 runtime / trace / snapshot / replay

### 4.2 自监控与恢复

- self-monitor
- drift detection
- health report
- recovery recommendation
- recovery action 编排

### 4.3 内在动机与自生成目标

- intrinsic motivation engine
- self-goal generation
- goal filtering / governance
- 自生成目标注入 goal tree

### 4.4 持续学习与适配

- transfer adapter
- continual learner
- reflection learner
- online evaluation
- autonomy benchmark
- curriculum / consolidation 基础设施

## 5. 多 Agent 编排底座

### 5.1 本地与分布式协作原语

- agent registry
- task delegator
- inter-agent bus
- coordination strategy
- shared state store
- lifecycle manager

### 5.2 后续分布式增强

- 真正的 distributed bus
- 多实例共享状态后端
- 更强冲突解决
- 去中心化注册
- 跨实例 tracing / observability

## 6. 治理与安全底座

### 6.1 策略与审批

- policy provider
- approval gating
- tenant / role / permission model
- session sharing
- reviewer identity / audit

### 6.2 预算与资源治理

- token / cost / latency budget
- rate limiting
- timeout
- circuit breaker
- transient / permanent error 语义
- resident session TTL / LRU

### 6.3 内容与输入输出治理

- input screening
- output screening
- structured ask_user validation
- 风险等级与安全响应机制

## 7. 协议、服务端与 SDK 能力

### 7.1 协议

- commands / events / schema versioning
- replay / checkpoint / approval / goal / runtime 事件一致性
- streaming 语义
- multimodal input / observation / tool result 语义

### 7.2 Runtime Server

- hosted runtime API
- auth / permission checks
- webhook
- batch / bulk operations
- agent versioning
- remote eval / replay / trace / event API

### 7.3 SDK

- local / remote unified builder
- session handle
- client retry / reconnect / pagination
- SPI registration / validation

## 8. 可观测性、评估与运维底座

### 8.1 可观测性

- structured logs
- metrics
- tracing
- event stream
- runtime saturation reporting

### 8.2 评估与回归

- trace / replay / eval
- memory benchmark
- meta benchmark
- autonomy benchmark
- online eval pipeline

### 8.3 运维能力

- durable persistence
- audit trail
- release / migration support
- backfill / compatibility tooling

## 9. 明确不应放在平台层的内容

以下内容不应在 `NeuroCore` 主仓里以“产品逻辑”形式实现：

- 具体邮件、日历、IM、企业系统连接器的业务编排
- 个人助理的提醒策略、汇报风格、跟进节奏
- 具体工作流模板，例如周报、会议纪要、待办催办
- 面向个人助理产品的界面、交互文案与业务视图逻辑

这些应建立在平台 SPI、调度、记忆、自主与治理能力之上，由个人助理产品实现。

## 10. 直接结论

为了实现“可长期运行、可主动行动、可派发任务、可成长为超级助理”的目标，`NeuroCore` 平台必须承担以下五类底座：

1. 长期运行时与执行状态机
2. 长期记忆与检索系统
3. 自主能力与持续学习闭环
4. 多 Agent 编排与后续分布式协作底座
5. 治理、协议、服务端、SDK、可观测性与评估体系

只有这些底座能力在平台层收口后，基于该平台构建的个人助理产品，才有可能真正达到“超级助理”的形态。
