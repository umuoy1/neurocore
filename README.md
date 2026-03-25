# NeuroCore

NeuroCore 是一个面向 Agent 系统的基础内核、SDK 与运行时项目。

它要解决的问题不是“让大模型多调用几个工具”，而是把 Agent 从一次性的 `prompt + tool loop`，提升为一个可运行、可恢复、可治理、可积累的认知系统。

## 项目定位

NeuroCore 的目标是提供一套可以被业务系统、平台团队和 SaaS 产品复用的 Agent 底座：

- 作为嵌入式 SDK，直接集成到应用进程中。
- 作为托管式 Runtime，统一承载 Session、审批、审计、回放和评估。
- 作为协议与扩展点，连接模型、工具、记忆、策略和观测体系。

NeuroCore 不把 Agent 理解为“一个大 prompt”，而是理解为“一个有状态的认知运行时”。

## 为什么需要 NeuroCore

传统 ReAct 风格框架擅长解决“模型如何调用工具”，但通常不擅长处理下面这些问题：

- 长任务如何稳定推进，而不是被一次错误带偏。
- 多目标任务如何分解、排序和恢复。
- 运行中产生的经验如何沉淀为记忆和技能。
- 高风险动作如何进入审批和硬门控，而不是只靠模型自觉。
- 系统如何被审计、回放、对比和评估。
- 本地嵌入模式和托管运行模式如何共享同一套协议与语义。

NeuroCore 关注的核心不是“更复杂的提示词”，而是：

- 统一状态模型
- 认知周期编排
- 结构化记忆
- 风险与预算门控
- 可解释的 Workspace
- Trace / Replay / Eval

## 核心心智模型

理解 NeuroCore，先抓住下面几个对象：

- `Agent Profile`
  Agent 的静态定义。描述角色、领域、工具、记忆策略、运行预算和安全策略。

- `Session`
  一次具体运行实例。它持有当前状态、预算、目标树、检查点和策略状态。

- `Goal`
  任务不是一段松散自然语言，而是一组可管理、可分解、可恢复的目标。

- `Cognitive Cycle`
  Agent 不是围绕“单轮对话”运行，而是围绕一个个认知周期运行。每个周期都会读取上下文、形成候选行动、经过门控，再执行或升级。

- `Workspace Snapshot`
  一个周期里的统一上下文快照。它聚合输入、目标、记忆摘要、候选行动、风险评估、策略决策和最终选择依据。

- `Memory`
  NeuroCore 把记忆视为一等能力，而不是临时拼到 prompt 里的文本片段。典型分层包括 Working Memory、Episodic Memory，以及后续可扩展的 Semantic / Procedural Memory。

- `Policy + Meta Controller`
  工具执行前要经过硬门控层。这里负责风险判断、预算控制、审批升级、冲突检测和动作仲裁。

- `Trace / Replay / Eval`
  每一次运行都应该是可追踪、可回放、可比较的。否则 Agent 很难真正进入工程生产环境。

## 项目设计原则

- `Protocol First`
  先定义稳定的协议、状态模型和接口，再定义实现。SDK、Runtime、CLI、控制台、评估体系共享同一套核心对象。

- `Runtime First`
  即使是本地嵌入式调用，也按“有状态运行时”设计，而不是按“无状态函数”设计。

- `Cognitive Cycle First`
  高级能力围绕认知周期组织，而不是围绕 prompt 模板组织。

- `Safe by Default`
  风险控制、预算约束、审批、回放和审计不应是外挂，而应是默认内建。

- `Progressive Complexity`
  简单场景可以先从轻量模式起步，复杂场景再逐步打开记忆、策略、预测和托管运行能力。

## 产品形态

NeuroCore 面向三种形态设计：

- `Embedded Mode`
  作为本地 SDK 嵌入业务应用。适合单进程、低复杂度、快速集成场景。

- `Runtime Mode`
  作为独立服务托管运行。适合企业级、多租户、异步任务、审计与审批要求高的场景。

- `Hybrid Mode`
  控制面与数据面分离。适合一部分能力托管、一部分能力保留在内网或私有环境中的场景。

## 架构分层

NeuroCore 按下面的分层来理解最清楚：

```text
Application / Integration Layer
SDK / CLI / API Gateway
Runtime Layer
Cognitive Services
Infrastructure Adapters
```

更具体地说：

- 应用层关心业务目标和最终用户体验。
- SDK / Gateway 层负责接入与编程接口。
- Runtime 层负责 Session、Goal、Cycle、Workspace、Execution、Checkpoint。
- Cognitive Services 层负责 Reasoner、Memory、Predictor、Skill Router、Meta Controller。
- Adapters 层负责连接模型、存储、队列、工具、观测和外部系统。

## 仓库结构

这个仓库采用 monorepo 组织方式，核心目录如下：

- `packages/protocol`
  系统的协议源。定义核心类型、命令、事件和接口。

- `packages/sdk-core`
  面向开发者的核心 SDK。用于定义 Agent、创建 Session、本地运行，以及连接远程 Runtime。

- `packages/sdk-node`
  Node.js 场景下的适配层。包含 OpenAI-compatible 模型配置与默认 Reasoner 实现。

- `packages/runtime-core`
  有状态认知运行时内核。负责 Session 生命周期、Goal 管理、Cycle 驱动、Workspace 生成、工具执行和恢复能力。

- `packages/runtime-server`
  将 Runtime 暴露为服务端能力。适合托管部署、统一接入和平台化场景。

- `packages/memory-core`
  默认记忆能力与记忆接口实现。

- `packages/policy-core`
  风险控制、预算控制和动作门控等策略实现。

- `packages/eval-core`
  回放、评估、对比测试和基线任务执行能力。

- `examples/`
  一组覆盖不同使用方式的示例。

## 典型使用方式

### 1. 作为本地 SDK

开发者可以在进程内定义一个 Agent，并直接运行它：

```ts
import { defineAgent } from "@neurocore/sdk-core";

const agent = defineAgent({
  id: "demo-agent",
  role: "Assistant that can reason and call tools."
})
  .useReasoner(reasoner)
  .registerTool(tool);

const session = agent.createSession({
  agent_id: "demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: "inp_1",
    content: "Use the tool and summarize the result.",
    created_at: new Date().toISOString()
  }
});

const result = await session.run();
```

### 2. 作为托管 Runtime

你也可以把同一个 Agent 挂到 `runtime-server` 上，通过 HTTP API 创建 Session、读取 Trace、处理审批，再继续运行。

这让本地嵌入模式和托管模式共享同一套语义，而不是维护两套互不相干的框架。

### 3. 作为可治理 Agent 平台底座

当业务进入真实生产环境，NeuroCore 希望承接下面这些平台能力：

- Session 生命周期与恢复
- 高风险动作审批
- Trace / Workspace / Episode 查询
- Replay 与 Eval
- 多租户、审计和权限治理

## 仓库里的示例

可以把 `examples/` 看成一组面向不同问题的最小切片：

- `demo-session`
  最基础的 Agent Session 运行流程。

- `demo-cli`
  一个类似命令行代理的交互式示例。

- `demo-high-risk-change`
  高风险工具、人工确认与门控语义。

- `demo-tool-retry`
  工具超时、失败、重试与 fallback。

- `demo-checkpoint`
  Session 的 checkpoint / suspend / restore / resume。

- `demo-runtime-server`
  Runtime 作为服务端暴露时的 Session / Trace / Workspace / Episode 查询方式。

- `demo-runtime-parity`
  对比本地 SDK 与托管 Runtime 的调用语义一致性。

- `demo-replay`
  会话回放。

- `demo-eval`
  基线任务执行与评估。

- `demo-incident-diagnosis`
  一个更接近复杂知识密度任务的示例。

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装依赖

```bash
npm install
```

### 构建与类型检查

```bash
npm run build
npm run typecheck
```

### 运行示例

```bash
npm run demo:session
npm run demo:cli
npm run demo:runtime-server
npm run demo:runtime-parity
npm run demo:checkpoint
npm run demo:replay
npm run demo:eval
```

## 模型配置

如果你要运行依赖真实模型调用的示例，默认读取本地配置文件：

- `.neurocore/llm.local.json`

文件格式为：

```json
{
  "provider": "openai-compatible",
  "model": "your-model-name",
  "apiUrl": "https://your-openai-compatible-endpoint",
  "bearerToken": "your-token",
  "timeoutMs": 60000,
  "headers": {}
}
```

这个文件被 `.gitignore` 忽略，适合放本地私有凭证。

## 适合什么场景

NeuroCore 适合这些任务类型：

- 长任务、多步骤、可恢复的复杂执行
- 需要工具调用但不能只靠 prompt 编排的流程自动化
- 需要风险控制、审批和审计的企业 Agent
- 需要知识记忆、经验回放和系统评估的 Agent 平台
- 需要同时支持本地嵌入和托管运行的 Agent 基础设施

## 一句话总结

NeuroCore 不是一个“帮你把 prompt 包起来”的项目。

它是一个把 Agent 视为认知运行时来设计的基础设施项目：有协议、有状态、有记忆、有门控、有恢复能力，也有面向生产环境的治理与评估路径。
