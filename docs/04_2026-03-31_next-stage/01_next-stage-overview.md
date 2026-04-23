# NeuroCore 第二阶段：需求分析与整体规划

> 基于 2026-03-31 代码状态（P0-P3 + M7 全部完成），对六个阶段边界外方向的需求拆解与设计。
>
> 2026-04-23 排期修正：
> - 本文档保留第二阶段的原始设计顺序。
> - 当前实际执行优先级已调整为：`M12 / 更远期分布式增强 / 记忆系统后续演进`。
> - 因此，下面的 M8~M13 顺序应视为“设计参考”，不是当前正在执行的排期。
>
> 2026-04-22 状态修正：
> - `M10 / 技能强化学习` 已在代码中完成当前阶段收口，当前真实状态以 [`docs/README.md`](../README.md) 与 [`../03_2026-03-30_assessment/02_gap-analysis-and-roadmap.md`](../03_2026-03-30_assessment/02_gap-analysis-and-roadmap.md) 为准。
> - 本文中的 M10 仍保留为设计基线与需求索引，不再代表未实现状态。

## 1. 背景

NeuroCore 第一阶段已交付：

- 六模块认知架构（Cortex/Memory/Cerebellar/Amygdala/Basal Ganglia/Prefrontal + Global Workspace）
- 完整的 Session → Goal → Cycle → Action → Observation → Memory 主链路
- Hosted Runtime（认证、eval、replay、webhook、metrics）
- 132 个测试全部通过

第二阶段将 NeuroCore 从**单 Agent 认知引擎**扩展为**多 Agent 分布式认知平台**，同时深化六模块中尚未完成的高阶能力。

## 2. 六个方向总览

| # | 方向 | 定位 | 核心目标 |
|---|---|---|---|
| A | 多 Agent 分布式调度 | 横向扩展 | 多个 Agent 协作完成复杂任务，支持层级式、对等式、市场式协调 |
| B | 世界模型与外部设备接入 | 纵向深化（Cerebellar） | 通用感知-执行接口，支持摄像头/麦克风/机械臂/扬声器等外部设备 |
| C | 技能自动提炼的强化学习 | 纵向深化（Basal Ganglia） | 基于奖励信号的技能优化、探索-利用平衡、技能裁剪 |
| D | 运营控制台 | 运维层 | Web UI 实现实时监控、配置管理、trace 浏览、eval 仪表盘 |
| E | 通用自主体能力 | 整体跃迁 | 长时自主规划、自我目标生成、跨域迁移、持续学习 |
| F | 深层元认知与自评估 | 纵向深化（Prefrontal） | 从轻量门控升级为深层自评估、慢路径控制、失败诊断与校准学习 |

## 3. 依赖关系

```
          ┌─────────────────────────────────────┐
          │  E. 通用自主体能力                    │
          │  (依赖 A + B + C + F 全部完成)        │
          └──────────┬──────────────────┬────────┘
                     │                  │
       ┌─────────────┴─┐    ┌──────────┴────────┐
       │ A. 多 Agent    │    │ C. 强化学习        │
       │    分布式调度   │    │    技能提炼         │
       └───────┬───────┘    └──────────┬────────┘
               │                       │
       ┌───────┴───────┐    ┌──────────┴────────┐
       │ B. 世界模型    │    │ F. 深层元认知      │
       │    设备接入     │    │    与自评估        │
       └───────────────┘    └──────────┬────────┘
                                        │
                               ┌────────┴────────┐
                               │ D. 运营控制台    │
                               │                  │
                               └─────────────────┘
```

- **B（世界模型）** 是 A 的前置：多 Agent 需要共享世界状态
- **A（多 Agent）** 和 **C（RL）** 可并行推进
- **F（深层元认知）** 依赖当前 Runtime / Workspace / Memory / Predictor 主链，但不依赖 A 完成
- **D（控制台）** 独立于 A/B/C/F，但随着能力增长逐步扩展
- **E（通用自主体）** 是 A + B + C + F 的整合，最后推进

## 4. 新增 FR 编号分配

| FR 范围 | 方向 |
|---|---|
| FR-28 ~ FR-35 | A. 多 Agent 分布式调度 |
| FR-36 ~ FR-43 | B. 世界模型与外部设备接入 |
| FR-44 ~ FR-49 | C. 技能自动提炼的强化学习 |
| FR-50 ~ FR-55 | D. 运营控制台 |
| FR-56 ~ FR-61 | E. 通用自主体能力 |
| FR-62 ~ FR-69 | F. 深层元认知与自评估 |

## 5. 里程碑规划

### Milestone 8：世界模型与外部设备接入（B）

**目标**：将 Cerebellar 模块从"预测引擎"升级为"感知-预测-执行"完整世界模型。

**交付物**：Sensor SPI、Actuator SPI、DeviceRegistry、WorldStateGraph 接口、多模态感知管道

**预期完成度变化**：Cerebellar 75% → 90%

### Milestone 9：多 Agent 分布式调度（A）

**目标**：支持多个 Agent 实例协作执行复杂任务。

**交付物**：AgentRegistry、TaskDelegation 协议、InterAgentBus、协调策略

**预期完成度变化**：整体架构新增"多 Agent 层"

### Milestone 10：技能强化学习（C）

**目标**：将技能提炼从"阈值计数"升级为"奖励驱动的策略优化"。

**交付物**：RewardSignal、SkillPolicy、ExplorationStrategy、SkillEvaluator

**预期完成度变化**：Basal Ganglia 80% → 95%

**当前状态（2026-04-22）**：已完成当前阶段实现，已补 RewardSignal / RewardStore / RewardComputer、BanditSkillPolicy、探索-利用策略、SkillEvaluator、SkillTransferEngine、SkillOnlineLearner、prioritized replay，以及 reward/policy/exploration/evaluation/transfer 事件与 SQLite 持久化。

### Milestone 11：运营控制台（D）

**目标**：提供 Web UI 用于 Agent 运维、监控、调试。

**交付物**：Dashboard 前端、REST API 扩展、WebSocket 实时推送

**当前状态（2026-04-23）**：已完成当前阶段实现，已补齐 `auth/me`、Console 所需 REST 端点、鉴权 WS、持久会话聚合、审批历史聚合，以及 Dashboard / Session / Trace / Memory / Approval / Multi-Agent / Config 等主视图接线。

### Milestone 12：通用自主体能力（E）

**目标**：整合 A + B + C，实现长时自主规划和跨域迁移。

**交付物**：AutonomousPlanner、IntrinsicMotivation 增强、MetaLearning 框架

**施工计划（2026-04-24）**：已补齐代码优先实施总计划并完成当前阶段代码实现，见 [`../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md`](../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md)。

### Milestone 13：深层元认知与自评估（F）

**目标**：将 Prefrontal / Meta 从轻量门控升级为深层自评估、慢路径控制、失败诊断与校准学习。

**交付物**：MetacognitiveState、SelfEvaluationReport、DeliberationController、FailureDiagnosis、CalibrationProfile、Meta-Eval Harness

## 5.1 当前执行顺序（修正版）

### 当前：M12 当前阶段已完成

- `M12 / 通用自主体能力` 已完成当前阶段的 `Phase 0 ~ Phase 6` 实现，不再处于“规划中”状态。
- 当前代码已具备：自治状态面、自治规划、自我监控、内在动机、自生成目标、迁移适配、持续学习、自治增强与自治 benchmark 主链。

### 下一阶段：记忆系统后续演进 + 更长期自治基础设施

- 继续推进 `docs/05_2026-04-01_memory-evolution/` 中的后续记忆演进，包括更强检索后端、长期评估与 schema 演进。
- 在自治侧进入更长期增强，而不是继续补 M12 当前阶段缺口：
  - 趋势级自治分析
  - 更强在线学习与课程调度
  - 更成熟的自治 benchmark 运营化

### 更后阶段：更远期分布式增强

- 在当前自治与记忆主线稳定后，再推进真正分布式 bus、多实例共享状态后端、去中心化注册与更强冲突解决。

## 6. 详细设计文档索引

| 文档 | 内容 |
|---|---|
| [02_multi-agent-scheduling.md](./02_multi-agent-scheduling.md) | A. 多 Agent 分布式调度详细设计 |
| [03_world-model-and-devices.md](./03_world-model-and-devices.md) | B. 世界模型与外部设备接入详细设计 |
| [04_skill-reinforcement-learning.md](./04_skill-reinforcement-learning.md) | C. 技能自动提炼的强化学习详细设计 |
| [05_operations-console.md](./05_operations-console.md) | D. 运营控制台详细设计 |
| [06_general-autonomy.md](./06_general-autonomy.md) | E. 通用自主体能力详细设计 |
| [../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md](../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md) | E. 通用自主体能力代码优先实施总计划 |
| [../06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md](../06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md) | F. 深层元认知与自评估详细设计（2026-04-14 新文档） |
