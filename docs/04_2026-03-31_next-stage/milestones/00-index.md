# Milestone Tracker — Index

> 状态标记：⬜ 未开始 | 🔵 进行中 | ✅ 完成 | 🔴 阻塞

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
| M8 | B. 世界模型与设备接入 | FR-36 ~ FR-43 | 无 | ⬜ | [m8-world-model.md](./m8-world-model.md) |
| M9 | A. 多 Agent 分布式调度 | FR-28 ~ FR-35 | M8 | ⬜ | [m9-multi-agent.md](./m9-multi-agent.md) |
| M10 | C. 技能强化学习 | FR-44 ~ FR-49 | 无 | ⬜ | [m10-skill-rl.md](./m10-skill-rl.md) |
| M11 | D. 运营控制台 | FR-50 ~ FR-55 | 无 | ⬜ | [m11-console.md](./m11-console.md) |
| M12 | E. 通用自主体 | FR-56 ~ FR-61 | M9, M10 | ⬜ | [m12-autonomy.md](./m12-autonomy.md) |

M8 和 M10 可并行启动。M11 独立于所有方向。M12 最后推进。

## Execution Timeline

```
Week 1-4:   M8 (世界模型) + M10 (技能 RL) 并行启动
Week 5-8:   M8 收尾 + M9 (多 Agent) 启动 + M10 收尾
Week 9-12:  M9 收尾 + M11 (控制台) 启动
Week 13-16: M11 收尾 + M12 (通用自主体) 启动
Week 17-20: M12 收尾
```

关键路径: M8 → M9 → M12。M10 和 M11 在关键路径外并行推进。
