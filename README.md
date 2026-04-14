# NeuroCore

面向自主智能体的有状态认知运行时。

NeuroCore 不是一个把提示词、工具调用和观察串成线性循环的 Agent Demo，而是一个 **protocol-first / runtime-first** 的认知运行时：把推理、记忆、预测、风险治理、技能和元认知组织进统一的认知周期里，让智能体具备 **有状态、可恢复、可治理、可积累** 的执行能力。

---

## 它是什么

NeuroCore 试图把 Agent 从“提示词驱动的工具调用器”升级为“结构化运行时系统”。

核心思路：

- 把 LLM 视为认知系统中的一个组件，而不是全部系统本身。
- 把执行单位从单次 prompt 扩展为 `Agent Profile / Session / Goal Tree / Workspace Snapshot / Trace / Eval`。
- 把安全、审批、预算、回放、评测这些生产能力内建进运行时主链路，而不是事后外挂。
- 用统一协议同时支撑本地 SDK 与 Hosted Runtime。

---

## 为什么不是 ReAct

ReAct 解决了“让模型会调用工具”的问题，但在工程上仍有几个长期瓶颈：

- 线性链式执行，缺乏并行认知协作。
- 缺少显式世界模型与前向预测。
- 缺少持久记忆与跨会话积累。
- 缺少元认知、自评估和不确定性控制。
- 缺少内建的风险治理、审批与预算管理。
- 缺少会话级恢复、回放、审计和评测能力。

NeuroCore 的目标不是替代模型本身，而是为模型提供一个更像“认知操作系统”的运行环境。

---

## 核心架构

### 六模块 + 全局工作空间

- **Cortex / Reasoner**：高阶推理、规划、响应生成
- **Hippocampal / Memory**：记忆检索、情景编码、语义凝练、程序化经验沉淀
- **Cerebellar / Predictor**：前向模拟、结果预测、预测误差跟踪
- **Amygdala / Policy-Risk**：风险评估、预算约束、审批门控
- **Basal Ganglia / Skill**：技能匹配、习惯性动作激活、技能提炼
- **Prefrontal / Meta**：元认知、自评估、冲突检测、控制分配
- **Global Workspace**：提案竞争、广播、融合、压缩、快照生成

### 认知周期

一个典型周期不是 `Thought -> Action -> Observation` 的单链路循环，而是：

1. 输入进入 Session
2. 六模块并行产生提案 / 检索 / 预测 / 风险评估
3. Global Workspace 汇聚并竞争候选信息
4. Meta 层做控制分配、置信度评估、审批判断或安全降级
5. 执行动作或升级审批
6. 观测结果写回记忆、轨迹与评测系统

---

## 关键能力

### 1. 有状态 Session

每次执行都不是一次性的 prompt 调用，而是一个拥有生命周期的 Session：

- `created -> running -> waiting -> completed | failed | aborted | escalated`
- 支持 checkpoint / resume / replay
- 支持本地运行与远程托管运行时的语义对齐

### 2. Goal Tree

任务不是一段扁平字符串，而是可管理、可分解、可恢复的目标树：

- 子目标递归分解
- 父子状态派生
- 优先级与依赖排序
- 结构化进度跟踪

### 3. Workspace Snapshot

每个认知周期都会生成结构化快照，聚合：

- 输入事件
- 活跃目标
- 记忆摘要
- 候选行动
- 预测结果
- 风险 / 策略决策
- 竞争日志
- 元认知状态

### 4. 四层记忆

当前主链路以四层记忆为基础：

- **Working Memory**：当前任务上下文
- **Episodic Memory**：按会话沉淀的经验事件
- **Semantic Memory**：从经验中提炼出的稳定知识
- **Procedural Memory**：从反复成功的模式中沉淀出的程序化经验

> 下一阶段的记忆演进与五层设计、SQL-first 持久化方向，见 `docs/README.md` 与 `docs/05_2026-04-01_memory-evolution/`。

### 5. 治理与安全

治理能力不是外挂，而是主链路能力：

- 风险等级与策略决策
- 工具参数 Schema 校验
- 审批升级流
- 预算与配额控制
- Trace / Replay / Eval 全链路可追踪

### 6. Hosted Runtime

NeuroCore 同时支持两种使用方式：

- **Embedded SDK**：直接在本地应用中定义 Agent、创建 Session、执行周期
- **Hosted Runtime**：通过 `runtime-server` 暴露 HTTP API、异步执行、SSE、Webhook、审批与评测接口

---

## 当前状态

截至当前主分支，项目整体状态可以概括为：

- Runtime 主链路、Hosted Runtime、World Model、Device 接入、多 Agent 原语已进入代码库
- M0 ~ M8 已形成主体闭环；M9 的本地多 Agent 核心闭环已补齐
- Personal Assistant Phase A 已有局部落地
- Console 已有文档、接口契约与预实现，但尚未形成完整产品闭环
- 深层元认知升级已进入实现阶段，但仍在持续演进

> 详细进度、里程碑判断和设计演进请以 `docs/README.md` 为准；它是项目的文档导航与进度跟踪入口。

---

## 仓库结构

```text
neurocore/
├── packages/
│   ├── protocol/        # 核心类型、Schema、命令、事件、接口契约
│   ├── runtime-core/    # 有状态认知运行时内核
│   ├── sdk-core/        # Agent 定义、Session 创建、本地执行 API
│   ├── sdk-node/        # Node.js 适配层与模型接线
│   ├── runtime-server/  # Hosted Runtime HTTP API / async / stream / webhook
│   ├── memory-core/     # 记忆系统实现
│   ├── policy-core/     # 风险、预算、审批、策略门控
│   ├── eval-core/       # Trace、Replay、Eval、Benchmark
│   ├── world-model/     # 世界模型相关能力
│   ├── device-core/     # 设备抽象与接入能力
│   ├── multi-agent/     # 多 Agent 原语与协作能力
│   └── console/         # Operations Console 前端包
├── examples/            # CLI、runtime-server、world-model、personal-assistant 等示例
├── tests/               # 单元、集成、产品化与评测测试
├── docs/                # 架构、协议、路线、控制台、个人助理、元认知设计文档
├── TODO.md              # 工程待办与里程碑工作项
└── README.md
```

---

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装与构建

```bash
npm install
npm run build
npm run typecheck
```

### 运行测试

```bash
npm test
```

### 常用示例

```bash
# 基础运行与会话能力
npm run demo:session
npm run demo:cli
npm run demo:checkpoint
npm run demo:memory

# Hosted Runtime / 运行模式 / Webhook
npm run demo:runtime-server
npm run demo:runtime-modes
npm run demo:webhooks

# 世界模型
npm run demo:world-model

# Personal Assistant
npm run demo:personal-assistant:web
npm run demo:personal-assistant:feishu

# Console
npm run console:dev

# Benchmark
npm run benchmark:longmemeval
```

### 模型配置

需要真实模型调用的示例，可创建 `.neurocore/llm.local.json`：

```json
{
  "provider": "openai-compatible",
  "model": "your-model-name",
  "apiUrl": "https://your-openai-compatible-endpoint",
  "bearerToken": "your-token",
  "timeoutMs": 60000
}
```

该文件已被 `.gitignore` 忽略。

---

## 最小使用示例

```ts
import { defineAgent } from "@neurocore/sdk-core";

const agent = defineAgent({
  id: "research-agent",
  role: "能够推理、调用工具并管理目标的助手。"
})
  .useReasoner(reasoner)
  .registerTool(searchTool)
  .registerTool(analyzeTool);

const session = agent.createSession({
  agent_id: "research-agent",
  tenant_id: "local",
  initial_input: {
    input_id: "inp_1",
    content: "研究当前电动汽车电池的市场趋势并总结。",
    created_at: new Date().toISOString()
  }
});

const result = await session.run();
console.log(result.output);
```

---

## 设计原则

- **Protocol First**：先定义稳定协议，再定义实现
- **Runtime First**：本地嵌入式调用也按有状态运行时设计
- **Cognitive Cycle First**：围绕认知周期组织能力，而不是围绕 prompt 模板组织能力
- **Safe by Default**：默认内建风险控制、预算约束、审批门控和审计追踪
- **Progressive Complexity**：从轻量能力起步，按需叠加记忆、预测、多 Agent、托管运行时与评测能力

---

## 适用场景

- 复杂任务自动化
- 企业流程 Agent
- 知识密集型 Agent
- 可治理 AI 平台
- 本地 SDK + 托管运行时的混合部署
- 个人助理 / IM Agent / 可视化 Console 驱动的 Agent 产品原型

---

## 文档导航

文档入口在 `docs/README.md`，建议按如下路径阅读：

1. 范式提出
2. SDK 设计与实施
3. 差距评估与路线
4. 下一阶段设计
5. 记忆系统演进
6. 运营控制台设计
7. 个人助理架构设计
8. 元认知系统演进

如果目标是直接理解项目现状，优先看：

- `docs/README.md`
- `docs/03_2026-03-30_assessment/`
- `docs/05_2026-04-01_memory-evolution/`
- `docs/06_2026-04-14_metacognition-evolution/`

---

## License

MIT
