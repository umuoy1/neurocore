# NeuroCore Agent 系统架构设计

## 1. 架构目标

本架构设计面向“作为基础 SDK 与对外架构提供”的 NeuroCore Agent 系统。其核心目标不是单纯让 Agent 能运行，而是让它具备以下平台属性：

1. 可嵌入
   能以 SDK 嵌入现有应用。

2. 可托管
   能作为独立 Runtime 和平台服务部署。

3. 可扩展
   能接入不同模型、存储、工具、策略与安全体系。

4. 可治理
   能被企业纳入权限、审计、监控、评估和运维体系。

5. 可演进
   能从 MVP 的轻量认知内核逐步演化到更强的世界模型与多 Agent 协作系统。

## 2. 架构总览

建议采用分层架构，而不是把所有逻辑堆进一个 Agent Executor。

```text
┌────────────────────────────────────────────────────────────┐
│                    Access / Integration Layer             │
│ API Gateway / SDK / CLI / Webhook / Event Connectors      │
└────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────┐
│                    Agent Runtime Layer                     │
│ Session Manager / Goal Manager / Cycle Scheduler          │
│ Workspace Coordinator / Policy Gate / Execution Manager   │
└────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────┐
│                  Cognitive Service Layer                   │
│ Reasoner / Memory / Predictor / Skill Router / Risk       │
│ Meta Controller / Human-in-the-Loop / Evaluator           │
└────────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────┐
│                 Platform Infrastructure Layer              │
│ Model Adapters / Tool Gateway / Event Bus / Queue         │
│ Vector DB / Graph DB / KV / Object Store / Trace Store    │
└────────────────────────────────────────────────────────────┘
```

## 3. 部署形态设计

### 3.1 Embedded Mode

适合：

- 本地工具型 Agent
- 单租户应用
- 轻量流程自动化
- 原型验证

特点：

- SDK 直接在业务进程中运行
- 默认使用本地内存或轻量存储
- 适合低复杂度和低并发

### 3.2 Runtime Mode

适合：

- 企业平台
- 多租户服务
- 需要异步调度的复杂任务
- 需要完整审计和观测

特点：

- Agent Runtime 独立部署
- Session、记忆、工具执行、审计均服务化
- 支持任务队列、重试、恢复和横向扩展

### 3.3 Hybrid Mode

适合：

- 数据不能离开内网，但模型/评估等能力可以托管

特点：

- 控制面托管
- 数据面本地执行
- 记忆与工具适配器可部署在客户私有环境

## 4. 核心组件设计

### 4.1 API Gateway / SDK Gateway

职责：

- 暴露统一访问接口
- 接收同步请求、异步任务、Webhook 和事件流
- 做租户鉴权、请求限流和基础审计

建议接口：

- HTTP API
- gRPC API
- SDK 本地适配接口

### 4.2 Session Manager

职责：

- 创建和恢复 Session
- 维护 Session 生命周期
- 管理检查点
- 管理任务取消、暂停、恢复和超时

关键设计：

- Session 状态必须持久化
- 每个 Session 应能从最近检查点恢复
- Session 与 Tenant、Agent Profile、Goal Tree 强绑定

### 4.3 Goal Manager

职责：

- 维护 Goal Tree
- 处理分解、合并、重排和依赖管理
- 监控完成条件

关键设计：

- Goal 变化必须事件化
- Goal 的每次状态变化都可追溯

### 4.4 Cycle Scheduler

职责：

- 驱动认知周期
- 决定每一周期调用哪些模块
- 控制快路径与慢路径切换

关键设计：

- 支持同步周期和异步周期
- 支持最大周期数、最大执行时长、最大预算
- 支持不同场景的周期模板

### 4.5 Workspace Coordinator

职责：

- 聚合模块 Proposal
- 执行仲裁
- 输出统一 Workspace Snapshot
- 推导周期决策

关键设计：

- 不是单纯缓存对象
- 必须显式实现竞争、优先级和门控逻辑
- 必须保留候选 Proposal，支持事后解释

### 4.6 Reasoner Service

职责：

- 对接 LLM 与推理模板
- 生成计划、解释、问题分解和自然语言输出

关键设计：

- 模型无关
- Prompt 模板只作为 Reasoner 的一部分，而不是系统总控
- 必须支持结构化输入输出

### 4.7 Memory Service

职责：

- 管理 Working/Episodic/Semantic/Procedural 四层记忆
- 提供检索、写入、巩固和清理

关键设计：

- 在线检索路径和离线巩固路径分离
- 不同记忆层使用不同存储后端
- Memory 读写必须带来源与策略标签

### 4.8 Predictor Service

职责：

- 对候选行动做前向预测
- 管理世界状态摘要
- 记录预测误差

关键设计：

- 允许多 Predictor 并存
- 使用统一 Prediction Schema
- 对高风险动作强制预测

### 4.9 Skill Registry & Skill Router

职责：

- 存储技能
- 匹配技能
- 触发技能
- 记录技能命中与失效

关键设计：

- 技能版本化
- 技能效果评估
- 技能撤销与回退机制

### 4.10 Risk Engine

职责：

- 评估风险、紧迫性、不确定性、影响等级

关键设计：

- 产出统一风险向量
- 支持领域策略覆盖默认策略

### 4.11 Meta Controller

职责：

- 置信度门控
- 冲突检测
- 预算控制
- 决策升级
- 人工介入判定

关键设计：

- 位于行动执行前的硬门控层
- 能阻止不安全或不经济的行动

### 4.12 Execution Manager / Tool Gateway

职责：

- 执行工具调用
- 统一处理鉴权、限流、超时、重试、幂等与补偿

关键设计：

- 区分只读工具与有副作用工具
- 有副作用工具必须支持审计和策略检查

### 4.13 Human-in-the-Loop Service

职责：

- 审批
- 中途介入
- 标注反馈
- 处理不可自动化决策

### 4.14 Trace & Evaluation Service

职责：

- 采集 Trace
- 执行回放
- 管理评估任务
- 输出版本对比结果

## 5. 数据与存储架构

NeuroCore 不应只有一个“数据库”，而应采用按职责划分的多存储架构。

### 5.1 事务型存储

存储对象：

- Session
- Goal Tree
- Policy Config
- Tool Metadata
- Audit Record

建议：

- 关系型数据库或强一致 KV

### 5.2 向量存储

存储对象：

- Episodic Memory
- Semantic Memory 索引
- Skill Recall 索引

### 5.3 图存储

存储对象：

- 世界状态图
- 实体关系
- 因果关系
- 目标依赖关系

### 5.4 对象存储

存储对象：

- 原始工件
- 执行附件
- 大型中间结果
- 回放快照

### 5.5 时序/日志存储

存储对象：

- Trace
- 周期事件
- 指标数据
- 异常事件

## 6. 事件模型设计

建议系统内部采用事件驱动模型，核心原因是：

- 认知周期天然是阶段事件流
- Session 恢复依赖事件与检查点
- 回放与评估需要重建时间序列
- 多模块并行更适合用事件解耦

### 6.1 核心事件类型

- `session.created`
- `session.resumed`
- `goal.created`
- `goal.updated`
- `cycle.started`
- `module.proposed`
- `workspace.committed`
- `action.approved`
- `action.executed`
- `observation.received`
- `memory.written`
- `prediction.recorded`
- `skill.matched`
- `skill.learned`
- `session.completed`
- `session.failed`

### 6.2 事件设计原则

- 事件应包含最小必要上下文
- 事件应可用于重放
- 关键事件必须幂等
- 事件必须具备租户与会话隔离标识

## 7. 一次典型任务的执行链路

```text
User / System Event
  -> API Gateway
  -> Session Manager
  -> Goal Manager updates active goals
  -> Cycle Scheduler starts cycle
  -> Workspace Coordinator requests:
       Memory Retrieve
       Skill Match
       Risk Evaluation
       Prediction
       Reasoning
  -> Workspace Coordinator arbitrates proposals
  -> Meta Controller gates selected action
  -> Execution Manager invokes tools / asks user / ends task
  -> Observation normalized
  -> Memory Service writes episode
  -> Predictor records prediction error
  -> Trace Service stores cycle trace
  -> Next cycle or complete
```

这条链路的关键点是：推理、预测、技能、风险与执行不再串成一条 prompt，而是在运行时中被编排和治理。

## 8. 横向扩展与并发设计

### 8.1 扩展单元

建议以 `tenant_id + agent_id + session_id` 作为主要隔离维度，以 Session 作为调度和恢复的基本单元。

### 8.2 并发模型

建议采用 Actor-like 模型：

- Session 是状态 Actor
- 各模块服务是无状态或轻状态 Worker
- 通过事件和命令进行通信

优点：

- 易于恢复
- 易于限流
- 易于做租户级隔离

### 8.3 任务队列

对于长任务和工具调用，建议采用异步队列：

- 防止请求线程阻塞
- 支持重试和退避
- 支持任务优先级

## 9. 容错与恢复设计

### 9.1 检查点

每个关键周期结束后建议生成检查点，至少包含：

- Goal Stack
- Workspace Snapshot
- Budget State
- Policy State
- 最近动作与观测

### 9.2 重试策略

重试应区分：

- 模型调用重试
- 工具调用重试
- 周期重试
- Session 恢复

不应采用统一粗暴重试。

### 9.3 降级策略

当高级模块不可用时，系统应支持降级：

- Predictor 不可用时，回退到规则评估
- Skill Router 不可用时，回退到 Reasoner 直接推理
- 语义记忆不可用时，保留工作记忆和情景记忆

## 10. 安全架构设计

### 10.1 权限模型

权限建议分为四层：

1. Tenant 权限
2. Agent Profile 权限
3. Session 临时权限
4. Tool 级动作权限

### 10.2 Secrets 管理

- SDK 模式下不建议把密钥直接暴露给 Agent 定义
- Runtime 应接入统一 Secret Manager
- 工具调用必须最小权限授权

### 10.3 审计

必须审计：

- 高风险动作
- 外部系统写操作
- 权限提升
- 人工审批结果
- 敏感数据访问

## 11. 可观测架构设计

### 11.1 三层观测模型

1. Metrics
   时延、成功率、成本、吞吐、错误率。

2. Traces
   认知周期、模块 Proposal、决策路径、工具调用链路。

3. Artifacts
   Prompt、Snapshot、Episode、回放结果、评估报告。

### 11.2 核心观测指标

- 平均周期数
- 任务完成率
- 周期中断率
- 计划重排次数
- 技能命中率
- 预测偏差率
- 人工介入率
- 单任务成本

## 12. 评估架构设计

评估不应是外围脚本，而应纳入平台内核。

### 12.1 评估对象

- Agent 版本
- Skill 版本
- Policy 版本
- Model 路由版本
- Predictor 版本

### 12.2 评估能力

- 回放固定任务集
- 对比不同版本结果
- 分析失败原因分布
- 跟踪技能沉淀前后收益

## 13. SDK 与 Runtime 的边界

### 13.1 SDK 负责

- 本地 Agent 定义
- 本地工具封装
- 配置和接入体验
- 嵌入式运行
- 调试与测试工具

### 13.2 Runtime 负责

- Session 托管
- 状态持久化
- 调度与扩缩容
- 权限和审计
- 多租户治理
- 统一观测和评估

### 13.3 共享协议

SDK 与 Runtime 必须共享：

- Agent Schema
- Goal Schema
- Workspace Schema
- Trace Schema
- Tool Contract
- Policy Contract

## 14. MVP 架构建议

为了控制复杂度，MVP 建议采用“单 Runtime 核心 + 可插拔适配器”的方式，而不是一开始拆成大量微服务。

### 14.1 MVP 组件

- API / SDK Gateway
- Session & Goal Manager
- Cycle Scheduler
- Workspace Coordinator
- Reasoner Adapter
- Memory Adapter
- Tool Gateway
- Meta Controller
- Trace Store

### 14.2 MVP 特点

- 支持单机和小规模分布式部署
- 支持基础检查点与回放
- 支持技能注册，不强制技能自动学习
- 支持 Predictor 接口，但允许仅用规则预测器

## 15. 演进路线

### Phase 1: Cognitive Runtime MVP

目标：

- 把 ReAct Agent 升级为有状态、可回放、可治理的认知运行时

交付：

- Goal Stack
- Workspace
- Memory
- Meta Gate
- Tool Gateway
- Trace/Eval

### Phase 2: Predictive Agent Runtime

目标：

- 在关键行动前加入预测与风险控制

交付：

- Predictor Service
- 预测误差学习
- 技能效果跟踪
- 策略路由增强

### Phase 3: Adaptive Agent Platform

目标：

- 让 Agent 开始稳定积累程序技能和跨会话经验

交付：

- 技能自动提炼
- 语义记忆巩固
- 更强的评估闭环

### Phase 4: Multi-Agent Cognitive Network

目标：

- 在共享协议之上扩展多 Agent 协作

交付：

- 委托协议
- Agent 间消息总线
- 共享任务图
- 跨 Agent 审计

## 16. 架构结论

NeuroCore 的架构设计必须把“新 Agent 范式”的核心思想落到四个基础事实上：

1. Agent 是运行时，不是 prompt。
2. 决策来自认知周期，不是单次推理。
3. 能力积累依赖记忆、技能、预测和评估闭环。
4. 对外可用性取决于治理、观测和恢复能力，而不只取决于模型效果。

因此，对外提供的基础架构应是：

- 一个统一协议驱动的 Agent Runtime
- 一组可嵌入的 SDK
- 一套可替换的认知插件接口
- 一条从 MVP 到复杂系统的明确演进路径

这也是 NeuroCore 从“理论提案”走向“工程底座”的关键。
