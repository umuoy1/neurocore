# Milestone Tracker — Index

> 状态标记：⬜ 未开始 | 🔵 进行中 | ✅ 完成 | 🔴 阻塞
>
> 2026-04-23 排期说明：
> - 本索引只覆盖第二阶段原始 M8 ~ M12 里程碑。
> - 当前实际执行顺序已调整为：M11 当前阶段完成后，转向 `M12 / 更远期分布式增强 / 记忆系统后续演进`。
>
> 2026-04-22 状态修正：
> - `M10 / 技能强化学习` 已完成当前阶段实现，当前真实状态以 [`../../README.md`](../../README.md) 为准。

## Dependency Graph

```
M8  世界模型与设备接入 (B)  ← 前置
  └→ M9  多 Agent 调度 (A)  ─┐
M10 技能强化学习 (C)        ─┤→ M12 通用自主体 (E)
M11 运营控制台 (D)  独立     ┘
```

## Overview

| Milestone | 方向 | FR 范围 | 依赖 | 状态 | 文件 |
|---|---|---|---|---|---|
| M8 | B. 世界模型与设备接入 | FR-36 ~ FR-43 | 无 | ✅ | [m8-world-model.md](./m8-world-model.md) |
| M9 | A. 多 Agent 分布式调度 | FR-28 ~ FR-35 | M8 | ✅ | [m9-multi-agent.md](./m9-multi-agent.md) |
| M10 | C. 技能强化学习 | FR-44 ~ FR-49 | 无 | ✅ | [m10-skill-rl.md](./m10-skill-rl.md) |
| M11 | D. 运营控制台 | FR-50 ~ FR-55 | 无 | ✅ | [m11-console.md](./m11-console.md) |
| M12 | E. 通用自主体 | FR-56 ~ FR-61 | M9, M10 | ✅ | [m12-autonomy.md](./m12-autonomy.md) |

M8 / M9 / M10 / M11 当前阶段已完成。
M12 当前阶段已实现完成，代码优先实施总计划与验收口径见 [`../../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md`](../../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md)。

## Execution Timeline

```
Now:        M12 通用自主体能力
Next:       更远期分布式增强
Later:      记忆系统后续演进与更强后端
Future:     更大规模运行与自治集群能力
```

关键路径（设计视角）已从 `M8 → M9 → M10 → M12` 收口到 `M12`；但当前执行优先级已从原始时间线切换。
