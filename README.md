# NeuroCore

**面向自主智能体的有状态认知运行时**

NeuroCore 是一个受神经科学启发的结构化智能体基础设施。它实现了六模块认知系统加全局工作空间协调器，突破了 ReAct 范式"提示词 → 工具调用 → 观察 → 重复"的线性循环，构建了一个有状态、可恢复、可治理、可积累的认知运行时。

---

## 动机

ReAct 框架（Yao et al., 2022）解决了让大模型调用工具的问题，但留下了更深层的系统性缺陷：

| 局限 | ReAct | NeuroCore |
|---|---|---|
| 线性链式推理，无并行认知能力 | 串行 `Thought → Action → Observation` | 每个认知周期内六模块并行处理 |
| 无世界模型，无法做预测性模拟 | 纯反应式——先做再看 | Predictor 在执行前提交前向模拟结果 |
| 无持久记忆架构 | 上下文窗口即全部记忆 | 三层记忆：工作记忆、情景记忆、语义记忆；支持跨会话检索 |
| 无元认知能力 | 无法评估自身的置信度 | MetaController 动态置信度评分、冲突检测、资源分配 |
| 无内在动机系统 | 完全由外部任务指令驱动 | 风险感知优先级排序、紧迫性信号、审批升级 |
| 单点故障导致级联崩溃 | 一次幻觉沿推理链放大 | Provider 隔离（`Promise.allSettled`）、指数退避重试、Session 级错误恢复 |
| 扁平任务表示 | 单一非结构化任务字符串 | 层次化 Goal Tree，支持分解、依赖排序、状态派生 |

NeuroCore 不把大模型当作"大脑"，而是把它当作**新皮层**——认知系统中的一个专门组件，与记忆、预测、动机、技能和元认知监控协同工作。

---

## 理论基础

NeuroCore 的架构源于三个跨学科领域的融合：

- **神经科学**：Baars 全局工作空间理论（1988）——信息竞争与广播机制；Friston 自由能原理（2006）——预测误差最小化；预测编码（Rao & Ballard, 1999）——层次化误差传播
- **认知科学**：Kahneman 双过程理论——快（习惯）与慢（审慎）两条推理通路；元认知——置信度监控与认知控制
- **计算机科学**：贝叶斯推断、层次化强化学习、Actor 模型并发、结构化协议工程

---

## 架构

### 六大神经模块 + 全局工作空间

```
                    ┌─────────────────────────────────────┐
                    │          全局工作空间                  │
                    │    竞争 · 广播 · 融合 · 压缩           │
                    └──────────────┬──────────────────────┘
                                   │
        ┌──────────┬───────────┬───┴───┬──────────┬──────────┐
        ▼          ▼           ▼       ▼          ▼          ▼
   ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐
   │  新皮层  ││ 海马体  ││  小脑   ││ 杏仁核  ││基底神经节││ 前额叶  │
   │ Module  ││ Module  ││ Module  ││ Module  ││ Module  ││ Module  │
   │ (推理)  ││ (记忆)  ││ (预测)  ││ (风险)  ││ (技能)  ││ (元认知)│
   └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘└─────────┘
```

每个模块对应一个脑区功能域，作为独立的认知服务运行：

| 模块 | 脑区映射 | 认知职责 | 实现形态 |
|---|---|---|---|
| **新皮层模块（Cortex）** | 大脑新皮层 | 高阶推理、规划、响应生成 | LLM 驱动的 Reasoner（OpenAI 兼容适配器） |
| **海马体模块（Hippocampal）** | 海马体 | 情景编码、记忆检索、语义凝练 | 工作记忆 + 情景记忆 + 语义记忆三层架构 |
| **小脑模块（Cerebellar）** | 小脑 + 顶叶 | 前向模拟、结果预测、预测误差追踪 | Predictor SPI，支持可插拔实现 |
| **杏仁核模块（Amygdala）** | 杏仁核 | 风险评估、威胁检测、紧迫性信号 | PolicyProvider，可配置风险等级（warn / block） |
| **基底神经节模块（Basal Ganglia）** | 基底神经节 | 技能匹配、习惯性行为激活 | SkillProvider SPI，模式匹配提案 |
| **前额叶模块（Prefrontal）** | 前额叶皮层 | 元认知、冲突检测、资源分配、审批门控 | MetaController，风险排序选择与动态置信度 |

### 认知周期

不同于 ReAct 的线性链条，NeuroCore 执行结构化的认知周期：

```
  [感知输入]
       │
       ▼
  ┌──────────────────────────────────────────┐
  │  六模块并行处理                            │
  │  Memory.retrieve()   →  记忆提案          │
  │  Skill.match()       →  技能提案          │
  │  Reasoner.plan()     →  推理提案          │
  │  Predictor.predict() →  预测结果          │
  │  Policy.evaluate()   →  策略决策          │
  └──────────────────┬───────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────┐
  │  全局工作空间                              │
  │  提案竞争 + 冲突融合                       │
  │  显著性加权 + 目标对齐评分                  │
  │  Token 感知上下文压缩                      │
  │  工作空间快照生成                          │
  └──────────────────┬───────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────┐
  │  MetaController（前额叶仲裁）             │
  │  按风险排序候选行动                        │
  │  动态置信度评分                            │
  │  可配置审批升级阈值                        │
  └──────────────────┬───────────────────────┘
                     │
                     ▼
  [执行 / 审批升级 / 终止]
       │
       ▼
  [观察 → 记忆写入 → 轨迹记录]
```

每个周期生成一个 **Workspace Snapshot（工作空间快照）**——结构化的上下文物件，包含输入事件、活跃目标、记忆摘要、候选行动、预测结果、策略决策、竞争日志和预算评估。

---

## 核心概念

### Agent Profile（智能体档案）

智能体的静态定义：角色、领域、工具集、记忆策略、运行预算、安全策略和上下文配置。

### Session（会话）

有状态的执行实例，拥有完整生命周期：`created → running → waiting → completed | failed | aborted | escalated`。会话支持挂起、检查点、恢复和继续运行。

### Goal Tree（目标树）

任务不是一段松散的自然语言，而是一组可管理、可分解、可恢复的结构化目标：

- 递归分解（Reasoner 驱动的子目标生成）
- 父子状态派生（子目标完成 → 父目标进度更新）
- 优先级与依赖排序
- 生命周期时间戳（`created_at`、`updated_at`）

### Workspace Snapshot（工作空间快照）

每个认知周期的结构化上下文物件——聚合自记忆、技能、推理器、预测器和策略模块。内含 **CompetitionLog（竞争日志）**，记录提案评分、来源权重、目标对齐度、冲突检测和选择推理。

### 记忆系统

三层记忆作为一等能力：

| 层次 | 用途 | 实现 |
|---|---|---|
| **工作记忆（Working Memory）** | 当前任务上下文 | 有界内存存储，可配置 `maxEntries`，FIFO 淘汰 |
| **情景记忆（Episodic Memory）** | 经验记录 | 按会话存储的 Episode，支持跨会话/跨租户检索 |
| **语义记忆（Semantic Memory）** | 知识凝练 | 从 Episode 中提炼的语义模式，支持跨会话积累 |

所有检索使用可配置的 `retrieval_top_k`（无硬编码上限）。

### 策略与治理

工具执行在调用前经过硬门控层：

- **风险等级**：`none` / `low` / `medium` / `high` → 高风险动作自动升级审批
- **策略决策**：`allow` / `warn` / `block` — warn 触发审批流，block 阻止执行
- **参数校验**：基于 `inputSchema` 的 required 检查和类型校验，拒绝无效参数
- **预算执行**：多维度配额（cycle 上限、tool call 上限、token 预算）
- **可配置审批阈值**：可调整的不确定性阈值，超出时自动升级

### 轨迹 / 回放 / 评估

每个周期记录为 **CycleTrace**——支持完整的会话回放、逐步调试和自动化评估：

- **Trace Store**：按周期记录提案、行动、预测、观察和工作空间状态
- **Replay Runner**：从记录的轨迹确定性重放
- **Eval Harness**：定义评估用例与期望，运行自动化通过/失败判定，生成评估报告

---

## 运行时加固

NeuroCore 实现了多层韧性机制以支撑生产环境：

- **Provider 隔离**：四个采集方法（记忆、技能、预测、策略）全部使用 `Promise.allSettled`，单个 Provider 故障不会导致周期崩溃
- **Reasoner 容错**：`plan()` 和 `respond()` 失败时优雅降级，周期以空提案/空行动继续
- **工具参数校验**：基于 Schema 的参数验证（required 属性检查、类型检查），在调用工具前拒绝无效参数
- **指数退避**：工具重试使用 `baseDelay × 2^(attempt-1) + jitter` 替代固定延迟
- **Session 并发保护**：`SessionManager.acquireSessionLock()` 阻止同一会话上的并发 `runOnce` / `resume` / `decideApproval` 调用
- **Hydrate 防覆盖**：`SessionManager.hydrate()` 拒绝覆盖已存在的会话
- **活跃时间追踪**：所有变更操作更新 `last_active_at` 时间戳
- **上下文预算**：Token 感知压缩，分阶段裁剪（摘要截断 → 提案精简 → 目标截断 → 总结截断）

---

## 仓库结构

```
neurocore/
├── packages/
│   ├── protocol/          # 核心类型、Schema、命令、事件和接口定义
│   ├── runtime-core/      # 有状态认知运行时内核
│   ├── sdk-core/          # 面向开发者的 SDK（defineAgent、createSession、run）
│   ├── sdk-node/          # Node.js 适配层（OpenAI 兼容 Reasoner）
│   ├── runtime-server/    # HTTP API 服务（async、stream、SSE、webhooks）
│   ├── memory-core/       # 工作 / 情景 / 语义记忆实现
│   ├── policy-core/       # 风险控制、预算执行、动作门控
│   └── eval-core/         # 回放、评估、基线测试、远程评估
├── tests/                 # 测试套件（单元 + 集成 + 加固 + 基线）
├── examples/              # 覆盖所有使用方式的示例
└── docs/                  # 架构文档、需求规格、协议规范、路线图
```

9 个包，**~8,200 行 TypeScript**，**47+ 确定性测试**（含 LLM 基线测试共 81+），覆盖单元、集成、加固和评估场景。

---

## 使用方式

### 嵌入式 SDK

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
```

### 托管运行时

同一个 Agent 可以注册到 `runtime-server`，通过 HTTP API 访问：

- `POST /v1/sessions` — 创建会话
- `POST /v1/sessions/:id/run` — 执行周期
- `POST /v1/sessions/:id/resume` — 从等待/升级状态恢复
- `POST /v1/approvals/:id/decide` — 审批或拒绝升级的操作
- `GET /v1/sessions/:id/traces` — 查询周期轨迹
- `POST /v1/evals/runs` — 运行评估用例
- `GET /v1/evals/runs/:id` — 获取评估报告

两种模式共享相同的语义——本地 SDK 和远程运行时消费同一套协议类型。

### 支持的运行模式

| 模式 | 说明 |
|---|---|
| **Sync（同步）** | 阻塞执行，返回最终结果 |
| **Async（异步）** | 后台执行，通过轮询或 Webhook 获取结果 |
| **Stream（流式）** | 通过 SSE 增量交付 |

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

### 运行示例

```bash
npm run demo:session          # 基础 Session 生命周期
npm run demo:cli              # 交互式 CLI Agent
npm run demo:runtime-server   # 托管运行时 HTTP API
npm run demo:runtime-parity   # 本地与托管语义一致性
npm run demo:checkpoint       # 检查点 / 挂起 / 恢复
npm run demo:replay           # 会话回放
npm run demo:eval             # 基线评估
```

### 模型配置

需要真实模型调用的示例，创建 `.neurocore/llm.local.json`：

```json
{
  "provider": "openai-compatible",
  "model": "your-model-name",
  "apiUrl": "https://your-openai-compatible-endpoint",
  "bearerToken": "your-token",
  "timeoutMs": 60000
}
```

此文件已被 `.gitignore` 忽略。

---

## 设计原则

| 原则 | 说明 |
|---|---|
| **Protocol First（协议优先）** | 先定义稳定的类型与接口，再定义实现。所有包共享同一套核心对象。 |
| **Runtime First（运行时优先）** | 即使是本地嵌入式调用，也按有状态运行时设计，而非无状态函数。 |
| **Cognitive Cycle First（认知周期优先）** | 高级能力围绕认知周期组织，而非围绕提示词模板组织。 |
| **Safe by Default（默认安全）** | 风险控制、预算约束、审批门控和审计追踪默认内建，而非外挂。 |
| **Progressive Complexity（渐进复杂度）** | 从轻量推理器 + 工具起步，按需叠加记忆、策略、预测和托管运行能力。 |

---

## 适用场景

- **复杂任务自动化**：多步骤、可恢复的执行，支持目标分解与状态管理
- **企业流程 Agent**：跨系统工作流，内置权限边界、审计和审批
- **知识密集型 Agent**：通过情景记忆与语义记忆持续积累经验
- **可治理 AI 平台**：多租户运行时，集成风险门控、轨迹追踪、会话回放和自动化评估
- **混合部署**：本地 SDK 处理内网逻辑 + 托管运行时承载治理要求

---

## 许可

私有项目，保留所有权利。
