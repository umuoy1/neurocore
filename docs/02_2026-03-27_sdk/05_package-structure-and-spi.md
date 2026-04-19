# NeuroCore Agent SDK 包结构与 SPI 设计

## 1. 文档目标

本文档定义 NeuroCore 的代码组织方式、包边界、依赖规则和扩展点，目标是让后续实现阶段能够：

- 明确哪些代码属于协议层，哪些属于运行时，哪些属于适配器
- 明确哪些包可被外部开发者直接依赖
- 明确哪些 SPI 是对外开放的稳定扩展点
- 避免把业务逻辑、模型接入、运行时状态和平台能力耦合在一起

## 2. 代码组织原则

### 2.1 Monorepo First

建议采用 Monorepo 管理以下内容：

- TypeScript 协议与 SDK
- Runtime Core
- 适配器
- 控制台前端
- 示例项目
- 文档和评估基线

原因：

- 协议变更频繁，需要统一升级
- Runtime 与 SDK 强依赖共享类型
- 评估、示例和适配器要跟随主版本演进

### 2.2 TypeScript First, Polyglot Later

建议首版采用 TypeScript 作为主实现语言，原因是：

- 对外 SDK 更容易率先覆盖 Node.js 生态
- 类型系统适合承载协议层
- 更利于同时覆盖前端控制台、后端 Runtime 和工具适配器

Python SDK 建议第二阶段通过协议生成和薄包装方式跟进，而不是首版双语言并行深度开发。

### 2.3 Core / Runtime / Adapter 三层隔离

必须严格区分：

1. Core Protocol
   纯协议、纯类型、纯接口。

2. Runtime Core
   会话、周期、目标、门控、状态流转。

3. Adapters
   LLM、存储、工具、队列、审计、观测等外部依赖。

## 3. 推荐仓库结构

```text
neurocore/
  docs/
  packages/
    protocol/
    sdk-core/
    sdk-node/
    runtime-core/
    runtime-server/
    policy-core/
    memory-core/
    eval-core/
    cli/
    ui-console/
    adapters/
      model-openai/
      model-anthropic/
      vector-pgvector/
      vector-milvus/
      store-postgres/
      queue-redis/
      tool-http/
      observability-otel/
  examples/
    quickstart-chat/
    coding-agent/
    enterprise-workflow/
  schemas/
    jsonschema/
    openapi/
  testkits/
    fixtures/
    benchmark-tasks/
    replay-cases/
```

## 4. 包职责设计

### 4.1 `packages/protocol`

职责：

- 定义所有稳定 Schema、枚举、事件和接口类型
- 作为 TS SDK、Runtime、控制台和代码生成的单一协议源

必须包含：

- Canonical types
- JSON Schema 导出
- OpenAPI 片段或生成器
- 版本信息

禁止包含：

- 任何网络请求逻辑
- 任何数据库逻辑
- 任何模型调用逻辑

### 4.2 `packages/sdk-core`

职责：

- 为开发者提供 Agent 定义 API
- 维护本地 Session 抽象
- 封装模块注册、工具注册、策略注册
- 提供 Embedded Mode 运行能力

必须包含：

- `defineAgent`
- `createSession`
- `run`
- `stream`
- `registerTool`
- `registerSkill`
- `registerPolicy`

不应包含：

- 托管 Runtime 的服务端逻辑

### 4.3 `packages/sdk-node`

职责：

- 提供 Node.js 场景下的文件、进程、HTTP、流式 IO 等适配能力
- 提供更贴近工程落地的默认工具实现

### 4.4 `packages/runtime-core`

职责：

- 实现 Agent 的有状态认知运行时
- 管理 Session 生命周期
- 管理 Goal Stack
- 驱动 Cognitive Cycle
- 实现 Workspace Coordinator 和 Meta Controller 的核心逻辑

它是整个系统最关键的内核包。

### 4.5 `packages/runtime-server`

职责：

- 把 `runtime-core` 暴露为服务端能力
- 实现 API、鉴权、异步任务、审批接口、管理接口

建议包含：

- HTTP/gRPC server
- session APIs
- trace APIs
- approval APIs
- eval APIs

### 4.6 `packages/policy-core`

职责：

- 承载输入安全、动作门控、预算控制、输出约束等策略实现

意义：

- 避免安全逻辑散落在 Runtime 各处
- 便于企业客户替换默认策略

### 4.7 `packages/memory-core`

职责：

- 定义记忆读写、摘要、巩固和检索的公共能力
- 提供默认 Working Memory 和 Episodic Memory 实现

### 4.8 `packages/eval-core`

职责：

- 支撑回放、对比、批量评估、基线任务执行

### 4.9 `packages/cli`

职责：

- 提供本地调试入口
- 提供 Replay、Eval、Schema 导出、项目初始化能力

### 4.10 `packages/ui-console`

职责：

- 提供可视化 Session、Cycle、Goal、Trace、Approval 和 Eval 控制台

### 4.11 `packages/adapters/*`

职责：

- 封装所有外部系统依赖

设计原则：

- 每个适配器包只处理一种外部依赖
- 不允许在核心包中直接写厂商 SDK

## 5. 包依赖规则

### 5.1 允许的依赖方向

```text
protocol
  ↑
sdk-core   memory-core   policy-core   eval-core
  ↑            ↑             ↑            ↑
runtime-core
  ↑
runtime-server / sdk-node / cli / ui-console
  ↑
adapters/*
```

更准确地说：

- `protocol` 不依赖任何内部业务包
- `runtime-core` 可以依赖 `protocol`、`memory-core`、`policy-core`
- `runtime-server` 可以依赖 `runtime-core`
- `adapters` 只能实现接口，不得反向侵入核心状态模型

### 5.2 明确禁止

- `protocol` 依赖 `runtime-core`
- `policy-core` 依赖具体模型厂商包
- `runtime-core` 直接依赖 OpenAI/Anthropic/数据库 SDK
- `ui-console` 依赖任何服务端内部私有模块

## 6. Runtime Core 内部模块拆分

`runtime-core` 建议进一步拆成以下子模块：

### 6.1 `session/`

职责：

- Session 创建、恢复、暂停、终止
- 检查点读写

### 6.2 `goal/`

职责：

- Goal Tree 管理
- Goal 分解与完成判断

### 6.3 `cycle/`

职责：

- Cognitive Cycle 驱动
- 快慢路径切换
- 周期上下文编排

### 6.4 `workspace/`

职责：

- Proposal 聚合
- 候选 Action 管理
- 决策快照生成

### 6.5 `meta/`

职责：

- 置信度、风险、预算和冲突门控

### 6.6 `execution/`

职责：

- Tool Gateway 编排
- 副作用动作执行
- Observation 标准化

### 6.7 `trace/`

职责：

- 周期 Trace 采集
- 生命周期事件记录

### 6.8 `learn/`

职责：

- Episode 生成
- 经验标签
- 技能提升候选

## 7. SDK Core 对外 API 设计

建议首版公开以下主对象：

### 7.1 `AgentBuilder`

职责：

- 构建 Agent Profile
- 挂载工具、技能、策略和记忆适配器
- 提供 `validate()` 做预检，拒绝重复注册和配置漂移
- 提供 `build()` 产出可复用的 built agent，与共享 runtime 对齐
- 显式暴露 `configurePolicy()` 与 `configureApprovalPolicy()` 两类配置入口

示意：

```ts
const agent = defineAgent({
  id: "coding-agent",
  role: "Repository problem solver",
});
```

### 7.2 `AgentSessionHandle`

职责：

- 持有单次运行上下文
- 暴露 `run`, `resume`, `cancel`, `checkpoint`, `replay`, `waitForSettled` 能力
- 本地 handle 与 remote handle 共享同一组 `SessionHandleLike` 语义

### 7.3 `RuntimeClient`

职责：

- 面向托管 Runtime 的客户端
- 本地 API 与远程 API 尽量语义一致
- 远程列表接口支持 trace / episode / event pagination
- 请求层具备 `AbortSignal` 超时、429/503 重试，以及 SSE `Last-Event-ID` 重连

### 7.4 `ReplayRunner`

职责：

- 回放指定 Session 或指定任务集

### 7.5 `EvalRunner`

职责：

- 运行基线评估集并输出对比报告

## 8. SPI 设计

### 8.1 SPI 分类

建议区分两类扩展点：

1. Hard SPI
   核心运行时必须依赖的接口。

2. Soft SPI
   可选增强接口。

### 8.2 Hard SPI 列表

- `Reasoner`
  - `plan(...)` 负责 Proposal
  - `respond(...)` 负责 CandidateAction 选择
  - `streamText(...)` 负责 `respond / ask_user` 的原生文本流输出
- `Tool`
- `PolicyProvider`
- `TraceStore`
- `SessionStore`

### 8.3 Soft SPI 列表

- `Predictor`
- `MemoryProvider`
- `SkillProvider`
- `ApprovalProvider`
- `EvalReporter`

### 8.4 SPI 稳定性等级

建议为每个接口标注：

- `stable`
- `beta`
- `experimental`

首版建议：

- `Tool`、`Reasoner`、`PolicyProvider`、`SessionStore` 标记为 `stable`
- `Predictor`、`SkillProvider`、`MemoryConsolidator` 标记为 `beta`
- 多 Agent 委托相关 SPI 标记为 `experimental`

## 9. 适配器模式设计

### 9.1 模型适配器

统一接口目标：

- 不同 LLM 能被 Reasoner 统一调度
- 模型差异不泄漏到业务层

模型适配器需要处理：

- 同步/流式调用
- 结构化输出
- 工具调用模式差异
- Token 统计
- 模型错误映射

### 9.2 存储适配器

建议拆成：

- `SessionStore`
- `TraceStore`
- `MemoryStore`
- `ArtifactStore`

不要设计一个万能 `StorageProvider`，否则后续职责会混乱。

### 9.3 工具适配器

工具适配器建议分两层：

1. Tool Definition
   面向 Agent 可见的声明。

2. Tool Transport
   负责 HTTP、RPC、本地进程、消息队列等真实执行方式。

## 10. 版本管理设计

### 10.1 版本维度

系统至少存在五类版本：

- Protocol Version
- Agent Profile Version
- Skill Version
- Policy Version
- Adapter Version

### 10.2 兼容策略

- Protocol 主版本升级时，Runtime 与 SDK 同步升级
- Agent Profile 升级要支持灰度发布
- Skill 与 Policy 可独立版本化

## 11. 测试分层设计

### 11.1 协议测试

目标：

- 校验 Schema 兼容性
- 校验 JSON Schema 与类型生成一致性

### 11.2 Runtime 单元测试

目标：

- 校验 Goal 流转
- 校验 Cycle 决策
- 校验门控逻辑

### 11.3 适配器契约测试

目标：

- 校验模型、存储、工具适配器符合 SPI

### 11.4 回放测试

目标：

- 给定固定输入和固定替身依赖，复现历史 Session

### 11.5 评估集测试

目标：

- 校验版本升级是否造成效果退化

## 12. 发布与分发设计

### 12.1 NPM 包

建议首版以 NPM 为主：

- `@neurocore/protocol`
- `@neurocore/sdk`
- `@neurocore/runtime`
- `@neurocore/policies`
- `@neurocore/eval`

### 12.2 Docker 镜像

Runtime 和控制台建议提供官方镜像：

- `neurocore/runtime-server`
- `neurocore/console`

### 12.3 模板项目

建议提供：

- Quickstart Template
- Enterprise Runtime Template
- Coding Agent Template

## 13. 首版包优先级

优先实现顺序建议如下：

1. `protocol`
2. `runtime-core`
3. `sdk-core`
4. `policy-core`
5. `memory-core`
6. `runtime-server`
7. `eval-core`
8. 关键适配器

## 14. 结论

NeuroCore 的工程落地不能从“一个大包”开始，否则后续所有扩展都会反向侵蚀内核。

首版必须先把：

- 协议层
- Runtime Core
- SDK Core
- Policy Core
- Memory Core
- Adapters

这几个边界切清楚。只有这样，后面引入更多模型、存储、技能、预测器和多 Agent 协作时，系统才不会失控。
