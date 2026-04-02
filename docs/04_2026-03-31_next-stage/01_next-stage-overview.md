# NeuroCore 第二阶段：需求分析与整体规划

> 基于 2026-03-31 代码状态（P0-P3 + M7 全部完成），对五个阶段边界外方向的需求拆解与设计。
>
> 2026-04-02 排期修正：
> - 本文档保留第二阶段的原始设计顺序。
> - 当前实际执行优先级已调整为：个人助理产品线 + Console 相关准备 → `docs/05_2026-04-01_memory-evolution/` → 未来再恢复 M11 完整实施。
> - 因此，下面的 M8~M12 顺序应视为“设计参考”，不是当前正在执行的排期。

## 1. 背景

NeuroCore 第一阶段已交付：

- 六模块认知架构（Cortex/Memory/Cerebellar/Amygdala/Basal Ganglia/Prefrontal + Global Workspace）
- 完整的 Session → Goal → Cycle → Action → Observation → Memory 主链路
- Hosted Runtime（认证、eval、replay、webhook、metrics）
- 132 个测试全部通过

第二阶段将 NeuroCore 从**单 Agent 认知引擎**扩展为**多 Agent 分布式认知平台**，同时深化六模块中尚未完成的高阶能力。

## 2. 五个方向总览

| # | 方向 | 定位 | 核心目标 |
|---|---|---|---|
| A | 多 Agent 分布式调度 | 横向扩展 | 多个 Agent 协作完成复杂任务，支持层级式、对等式、市场式协调 |
| B | 世界模型与外部设备接入 | 纵向深化（Cerebellar） | 通用感知-执行接口，支持摄像头/麦克风/机械臂/扬声器等外部设备 |
| C | 技能自动提炼的强化学习 | 纵向深化（Basal Ganglia） | 基于奖励信号的技能优化、探索-利用平衡、技能裁剪 |
| D | 运营控制台 | 运维层 | Web UI 实现实时监控、配置管理、trace 浏览、eval 仪表盘 |
| E | 通用自主体能力 | 整体跃迁 | 长时自主规划、自我目标生成、跨域迁移、持续学习 |

## 3. 依赖关系

```
          ┌─────────────────────────────────────┐
          │  E. 通用自主体能力                    │
          │  (依赖 A + B + C 全部完成)            │
          └──────────┬──────────────────┬────────┘
                     │                  │
       ┌─────────────┴─┐    ┌──────────┴────────┐
       │ A. 多 Agent    │    │ C. 强化学习        │
       │    分布式调度   │    │    技能提炼         │
       └───────┬───────┘    └──────────┬────────┘
               │                       │
       ┌───────┴───────┐    ┌──────────┴────────┐
       │ B. 世界模型    │    │ D. 运营控制台      │
       │    设备接入     │    │                    │
       └───────────────┘    └───────────────────┘
```

- **B（世界模型）** 是 A 的前置：多 Agent 需要共享世界状态
- **A（多 Agent）** 和 **C（RL）** 可并行推进
- **D（控制台）** 独立于 A/B/C，但随着能力增长逐步扩展
- **E（通用自主体）** 是 A + B + C 的整合，最后推进

## 4. 新增 FR 编号分配

| FR 范围 | 方向 |
|---|---|
| FR-28 ~ FR-35 | A. 多 Agent 分布式调度 |
| FR-36 ~ FR-43 | B. 世界模型与外部设备接入 |
| FR-44 ~ FR-49 | C. 技能自动提炼的强化学习 |
| FR-50 ~ FR-55 | D. 运营控制台 |
| FR-56 ~ FR-61 | E. 通用自主体能力 |

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

### Milestone 11：运营控制台（D）

**目标**：提供 Web UI 用于 Agent 运维、监控、调试。

**交付物**：Dashboard 前端、REST API 扩展、WebSocket 实时推送

### Milestone 12：通用自主体能力（E）

**目标**：整合 A + B + C，实现长时自主规划和跨域迁移。

**交付物**：AutonomousPlanner、IntrinsicMotivation 增强、MetaLearning 框架

## 5.1 当前执行顺序（修正版）

### 当前：个人助理 + Console 相关准备

- 个人助理作为当前主优先级，按 `docs/05_2026-04-01_personal-assistant/` 推进 Phase A。
- Console 当前只做接口契约、后端支持、预实现维护和文档整理，为未来 M11 恢复做准备。

### 下一阶段：记忆系统演进

- 完成个人助理当前阶段后，进入 `docs/05_2026-04-01_memory-evolution/`，推进五层记忆系统的需求、迁移与验证设计。

### 更后阶段：恢复 M11

- 待个人助理与记忆系统演进阶段收口后，再回到 M11，完成 Console 的正式联调、E2E 与完整交付。

## 6. 详细设计文档索引

| 文档 | 内容 |
|---|---|
| [02_multi-agent-scheduling.md](./02_multi-agent-scheduling.md) | A. 多 Agent 分布式调度详细设计 |
| [03_world-model-and-devices.md](./03_world-model-and-devices.md) | B. 世界模型与外部设备接入详细设计 |
| [04_skill-reinforcement-learning.md](./04_skill-reinforcement-learning.md) | C. 技能自动提炼的强化学习详细设计 |
| [05_operations-console.md](./05_operations-console.md) | D. 运营控制台详细设计 |
| [06_general-autonomy.md](./06_general-autonomy.md) | E. 通用自主体能力详细设计 |
