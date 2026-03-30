# NeuroCore Agent SDK 设计方案

## 1. 设计目标

在需求方案的基础上，NeuroCore Agent SDK 的设计目标是：

1. 用统一抽象把“认知模块化”转化成开发者可使用的 API。
2. 让简单场景可以轻量运行，复杂场景可以逐步启用高级能力。
3. 让所有关键行为都进入统一状态模型，而不是散落在 prompt 和业务代码里。
4. 让 SDK 与 Runtime 共用协议，避免双轨设计。
5. 让记忆、技能、推理、执行、安全、观测都是可插拔的。

## 2. 设计原则

### 2.1 Protocol First

优先定义协议、状态模型、事件模型和模块接口，再定义具体实现。这样 TypeScript SDK、Python SDK、托管 Runtime、控制台与评估平台都能共享同一套内核模型。

### 2.2 Runtime First

即使以 SDK 形式集成，也要按“有状态运行时”来设计，而不是按“无状态函数调用”来设计。因为目标栈、记忆、预算、风险、回放都依赖持久状态。

### 2.3 Cognitive Cycle First

所有高级能力都围绕认知周期展开，而不是围绕 prompt 模板展开。

### 2.4 Safe by Default

工具权限、预算、审计、回放、冲突检测、人工接入必须默认内建。

### 2.5 Progressive Complexity

开发者可以按需启用：

- 仅 LLM + Tool 的轻量模式
- 带目标栈和记忆的标准模式
- 带预测、技能和元认知的高级模式

## 3. 产品设计总览

NeuroCore 建议采用“协议层 + SDK 层 + Runtime 层 + 插件层”的产品结构。

```text
┌────────────────────────────────────────────────────┐
│                   Application Layer                │
│  Chat App / Workflow App / Coding Agent / SaaS    │
└────────────────────────────────────────────────────┘
                        │
┌────────────────────────────────────────────────────┐
│                     SDK Layer                      │
│ TS SDK / Python SDK / CLI / Testing Harness        │
└────────────────────────────────────────────────────┘
                        │
┌────────────────────────────────────────────────────┐
│                   Runtime Layer                    │
│ Session / Cycle Engine / Workspace / Policies      │
└────────────────────────────────────────────────────┘
                        │
┌────────────────────────────────────────────────────┐
│                Cognitive Plugin Layer              │
│ Reasoner / Memory / World Model / Skill / Guard    │
└────────────────────────────────────────────────────┘
                        │
┌────────────────────────────────────────────────────┐
│               Infrastructure Adapters              │
│ LLM / Vector DB / Graph DB / Queue / Storage       │
└────────────────────────────────────────────────────┘
```

## 4. 核心对象模型

### 4.1 Agent Profile

Agent Profile 是静态定义，描述某类 Agent 的长期配置。

建议字段：

- `agent_id`
- `name`
- `version`
- `role`
- `domain`
- `instruction_policy`
- `tool_policies`
- `memory_policies`
- `planning_policies`
- `risk_policies`
- `budget_policies`
- `default_skills`
- `observability_policies`

### 4.2 Agent Session

Session 是一次具体运行实例，是认知状态的持有者。

建议字段：

- `session_id`
- `agent_id`
- `tenant_id`
- `user_id`
- `session_mode`
- `session_state`
- `goal_stack`
- `workspace_state`
- `budget_state`
- `policy_state`
- `checkpoint_ref`

### 4.3 Goal

Goal 是第一等实体，不再只是自然语言任务描述。

建议字段：

- `goal_id`
- `goal_type`
- `title`
- `description`
- `parent_goal_id`
- `status`
- `priority`
- `deadline`
- `constraints`
- `dependencies`
- `acceptance_criteria`
- `progress`
- `owner`
- `escalation_policy`

### 4.4 Workspace Snapshot

Workspace Snapshot 是认知周期中的统一上下文载体。

建议字段：

- `cycle_id`
- `input_events`
- `active_goals`
- `context_summary`
- `memory_digest`
- `world_state_digest`
- `candidate_actions`
- `risk_assessment`
- `confidence_assessment`
- `budget_assessment`
- `policy_decisions`
- `decision_reasoning`

### 4.5 Episode

Episode 用于记录一次可复盘的任务片段。

建议字段：

- `episode_id`
- `trigger`
- `goal_refs`
- `selected_strategy`
- `actions`
- `observations`
- `outcome`
- `prediction`
- `prediction_error`
- `valence`
- `lessons`
- `artifacts`

### 4.6 Skill

Skill 是可复用的能力单元。

建议类型：

1. `reasoning_skill`
2. `workflow_skill`
3. `toolchain_skill`
4. `compiled_skill`

建议字段：

- `skill_id`
- `name`
- `version`
- `trigger_conditions`
- `required_inputs`
- `execution_template`
- `risk_level`
- `success_metrics`
- `cooldown_policy`
- `fallback_policy`

## 5. 认知模块到工程模块的映射

原始文档中的六大神经模块应被翻译为工程可实现模块，而不是照搬脑区命名进入接口层。

### 5.1 Cortex -> Reasoning Engine

职责：

- 高阶推理
- 计划生成
- 任务分解
- 方案比较
- 自然语言生成

工程建议：

- 使用统一的 `Reasoner` 接口适配不同模型
- 支持快速推理模式与深度推理模式
- 输入统一使用 `Workspace Snapshot`
- 输出统一使用结构化 `Reasoning Result`

### 5.2 Hippocampal -> Memory Engine

职责：

- 工作记忆维护
- 情景记忆写入和召回
- 语义记忆归纳
- 经验摘要生成

工程建议：

- 抽象 `MemoryStore`、`MemoryIndexer`、`MemoryConsolidator`
- 区分在线写入与离线巩固
- 检索结果必须带置信度、来源和适用性标记

### 5.3 Cerebellar -> Prediction Engine

职责：

- 世界状态摘要
- 行动前模拟
- 成本/风险/成功率预测
- 预测误差回写

工程建议：

- 第一阶段只要求 `Predict(action, context) -> Prediction`
- 不强制绑定复杂图模型
- 允许规则引擎、统计模型、轻量 LLM 模拟器、图模型并存

### 5.4 Amygdala -> Priority & Risk Engine

职责：

- 风险评估
- 紧迫性评估
- 信息缺口重要性排序
- 执行警戒等级调整

工程建议：

- 不做抽象情绪建模
- 聚焦对决策真正有价值的信号
- 输出统一风险向量：`risk`, `urgency`, `uncertainty`, `impact`

### 5.5 Basal Ganglia -> Skill Router

职责：

- 技能匹配
- 快速路径选择
- 模板执行
- 习惯化流程复用

工程建议：

- 支持静态技能注册与动态技能提炼
- 支持技能版本管理
- 支持技能命中解释

### 5.6 Prefrontal -> Meta Controller

职责：

- 置信度监控
- 冲突检测
- 资源预算分配
- 决策升级
- 人工介入触发

工程建议：

- 作为强制过闸模块存在
- 所有高风险动作必须经过 `Meta Controller`

### 5.7 Global Workspace -> Workspace Coordinator

职责：

- 聚合模块输出
- 完成候选信息仲裁
- 形成周期快照
- 推动下一步决策

工程建议：

- 它不是消息总线，而是状态仲裁器
- 它必须知道当前目标、预算、风险与上下文阶段

## 6. 运行时生命周期设计

NeuroCore 不应被设计为单轮“问答函数”，而应具有清晰的状态生命周期。

### 6.1 Session 生命周期

```text
Created -> Hydrated -> Running -> Waiting -> Suspended -> Resumed -> Completed
                                   │
                                   ├-> Escalated
                                   ├-> Failed
                                   └-> Aborted
```

### 6.2 单个认知周期

```text
Input
  -> Context Build
  -> Memory Retrieve
  -> Skill Match
  -> Candidate Plan Generate
  -> Prediction
  -> Meta Gate
  -> Action Execute
  -> Observation Normalize
  -> Learn & Commit
  -> Next Cycle / Exit
```

### 6.3 决策原则

每个周期结束后，系统必须在以下分支中做出一个明确决策：

1. `continue_internal`
   继续内部推理，不调用外部工具。

2. `ask_user`
   向用户补充关键信息。

3. `execute_tool`
   执行一个或一组外部动作。

4. `escalate`
   请求人工或更高权限模块介入。

5. `complete`
   当前目标或整个任务已经满足完成条件。

6. `abort`
   发现无法在当前策略和权限下安全完成。

## 7. SDK 接口设计

### 7.1 面向开发者的主接口

建议 SDK 对外暴露以下对象：

- `defineAgent`
- `createSession`
- `run`
- `stream`
- `resume`
- `registerTool`
- `registerSkill`
- `registerMemoryAdapter`
- `registerPredictor`
- `registerPolicy`
- `evaluate`
- `replay`

### 7.2 配置方式

建议采用“声明式配置 + 编程式扩展”混合模式。

声明式配置适合：

- Agent Profile
- 工具权限
- 预算策略
- 默认记忆策略
- 路由策略

编程式扩展适合：

- 自定义模块
- 自定义风险策略
- 自定义技能提炼器
- 自定义世界模型适配器

### 7.3 示例接口形态

```ts
const agent = defineAgent({
  id: "research-agent",
  model: "gpt-5.x",
  goals: { strategy: "hierarchical" },
  memory: { episodic: true, procedural: true },
  safety: { humanApprovalForHighRisk: true }
});

agent.registerTool(searchTool);
agent.registerSkill(literatureReviewSkill);
agent.registerPolicy(riskPolicy);

const session = await agent.createSession({
  userId: "u_123",
  input: "分析这个市场并给我一份进入策略"
});

const result = await session.run();
```

这里的重点不是语法，而是：

- Agent 定义是结构化的
- Session 是显式的
- 技能、策略、工具是插件化的
- 运行结果可回放、可审计、可评估

## 8. 模块接口设计

### 8.1 统一模块接口

所有认知模块建议实现统一接口：

```text
Module {
  name
  kind
  capabilities
  prepare(context)
  evaluate(snapshot)
  propose(snapshot)
  commit(outcome)
}
```

说明：

- `prepare`：在周期开始前做本地加载
- `evaluate`：对当前快照进行分析
- `propose`：向工作空间提交候选信息或候选行动
- `commit`：在行动结果返回后更新内部状态

### 8.2 模块输出规范

所有模块输出都应是结构化 Proposal，而不是自由文本。

Proposal 至少包含：

- `proposal_id`
- `module_name`
- `proposal_type`
- `salience_score`
- `confidence`
- `cost`
- `risk`
- `payload`
- `explanation`

### 8.3 Workspace 仲裁规则

仲裁不建议采用单一分值排序，而应采用多因子策略：

- 与当前主目标的相关性
- 风险等级
- 信息增益
- 时间敏感性
- 成本预算
- 先验策略偏好

## 9. 记忆设计

### 9.1 Working Memory

用途：

- 存放当前会话的短期上下文
- 支持快速读取
- 支持窗口压缩和阶段摘要

设计要点：

- 不直接等价于聊天记录
- 需要维护“当前状态摘要”和“决策链摘要”

### 9.2 Episodic Memory

用途：

- 记录具体任务过程和成败经验

设计要点：

- 写入粒度以“任务片段”或“关键周期”为单位
- 必须可追溯到工具、结果、风险和 lesson learned

### 9.3 Semantic Memory

用途：

- 存储稳定规则、业务知识、策略常识

设计要点：

- 不直接从单次会话写入
- 需要经过巩固、验证和版本化

### 9.4 Procedural Memory

用途：

- 存放技能模板和自动化流程

设计要点：

- 技能必须有触发条件和适用边界
- 技能不是黑盒 prompt，必须可解释、可审计、可回退

## 10. 世界模型设计

### 10.1 设计原则

世界模型在首版中不应被理解为必须构建一个宏大的通用生成模型，而应被理解为“对行动后果的可插拔预测能力”。

### 10.2 分层实现

建议分三层：

1. Rule Predictor
   基于规则、白名单、业务状态机做预测。

2. Statistical Predictor
   基于历史统计数据做成功率、时延、风险预测。

3. Generative Predictor
   基于 LLM、图模型或领域模拟器做复杂场景预测。

### 10.3 预测输出

统一输出结构建议包含：

- `expected_outcome`
- `success_probability`
- `side_effects`
- `estimated_cost`
- `estimated_duration`
- `required_preconditions`
- `uncertainty`

### 10.4 预测误差学习

预测系统必须消费真实执行反馈，形成：

- 错误分布
- 规则修正建议
- 高风险动作黑名单
- 技能失效提醒

## 11. 技能系统设计

### 11.1 技能来源

技能可以来自三类来源：

1. 人工编写
2. 从已有工作流导入
3. 从高频成功 Episode 自动提炼

### 11.2 技能匹配流程

```text
Current Context
  -> Context Embedding / Feature Extraction
  -> Candidate Skills Recall
  -> Risk Filter
  -> Applicability Check
  -> Select / Reject
```

### 11.3 技能执行模式

技能执行不应绕过元认知和安全网关。

即使技能被命中，也必须经过：

- 适用性验证
- 权限检查
- 预算检查
- 高风险审批

## 12. 安全与治理设计

### 12.1 策略分层

建议将策略拆成四层：

1. Input Policy
2. Reasoning Policy
3. Tool Policy
4. Output Policy

### 12.2 人工介入机制

系统应支持三类人工介入：

1. Pre-Approval
   高风险动作执行前审批。

2. Mid-Flight Intervention
   任务运行中介入、修正目标或修改权限。

3. Post-Review
   任务完成后审查和经验标注。

## 13. 可观测与开发者体验设计

### 13.1 Trace 视图

开发者必须能看到：

- 每个周期发生了什么
- 哪个模块提出了什么建议
- 为什么选择了某个行动
- 为什么放弃了其他候选
- 记忆写入了什么
- 预测和真实结果的差异是什么

### 13.2 Replay 视图

回放应支持：

- 逐周期重放
- 快照对比
- 模型/策略版本对比
- 决策路径差异分析

### 13.3 Evaluation Harness

SDK 应内置评估支撑能力：

- 场景集管理
- 批量回放
- 成功率和成本评估
- Prompt/策略/技能的 A/B 测试

## 14. 多 Agent 设计边界

第一阶段不应默认把多 Agent 协作做成核心路径，但架构必须为未来扩展预留协议。

预留能力包括：

- Agent 间消息协议
- 任务委托
- 共享记忆读写边界
- 跨 Agent 审批和追踪

第一阶段建议只支持：

- 单主 Agent
- 可选的子任务委托接口

## 15. 设计结论

NeuroCore Agent SDK 的设计核心，不是把六大脑区直接做成六个“花哨模块”，而是把它们翻译成一组稳定的工程抽象：

- Goal Stack
- Workspace Snapshot
- Reasoning Engine
- Memory Engine
- Prediction Engine
- Skill Router
- Meta Controller
- Trace & Eval

这组抽象应成为 SDK 的公共语言。上层开发者使用这些抽象定义 Agent，下层运行时使用这些抽象驱动认知周期，平台侧使用这些抽象完成治理与观测。
