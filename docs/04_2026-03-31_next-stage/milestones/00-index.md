# Milestone Tracker — Index

> 状态标记：⬜ 未开始 | 🔵 进行中 | ✅ 完成 | 🔴 阻塞 | ⏸ 延后
>
> 2026-04-02 排期说明：
> - 本索引只覆盖第二阶段原始 M8 ~ M12 里程碑。
> - 当前实际执行顺序已调整为：个人助理产品线 + Console 相关准备 → 记忆系统演进 → 未来再恢复 M11。
> - 因此，M11 当前记为“延后”，不是取消。

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
| M10 | C. 技能强化学习 | FR-44 ~ FR-49 | 无 | ⬜ | [m10-skill-rl.md](./m10-skill-rl.md) |
| M11 | D. 运营控制台 | FR-50 ~ FR-55 | 无 | ⏸ | [m11-console.md](./m11-console.md) |
| M12 | E. 通用自主体 | FR-56 ~ FR-61 | M9, M10 | ⬜ | [m12-autonomy.md](./m12-autonomy.md) |

M8 / M9 已完成。M11 设计与预实现资产已存在，但当前排期后置。

## Execution Timeline

```
Now:        个人助理 + Console 相关准备
Next:       记忆系统演进（docs/05_2026-04-01_memory-evolution）
Later:      恢复 M11 (控制台) 正式实施
Future:     M10 / M12 视主线需求再排期
```

关键路径（设计视角）仍是 M8 → M9 → M12；但当前执行优先级已从原始时间线切换。
