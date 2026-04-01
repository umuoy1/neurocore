# Goal Tree 可视化

## 页面路由

`/sessions/:sessionId/goals`

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to Session    Goals: sess_abc123                             │
│ [Expand All] [Collapse All] [Filter: status ▼] [Search...]          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ [active] Generate quarterly report                    pri: 1  45%    │
│   │                                                                  │
│   ├──[completed] Collect sales data                   pri: 2  100%  │
│   │                                                                  │
│   ├──[active] Analyze trends                          pri: 2  60%   │
│   │    │                                                             │
│   │    └──[pending] Validate outliers                 pri: 3  0%    │
│   │                                                                  │
│   ├──[pending] Format output                          pri: 2  0%    │
│   │                                                                  │
│   └──[blocked] Verify compliance                      pri: 3  0%    │
│          (depends on: goal_05)                                        │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ Selected Goal: "Analyze trends"                                      │
│ Type: task | Status: active | Priority: 2                            │
│ Description: Analyze Q1 vs Q4 trends across product lines            │
│ Dependencies: [goal_02 - Collect sales data]                         │
│ Acceptance Criteria:                                                  │
│   [ ] Trend direction identified for each metric                     │
│   [ ] Outliers flagged for review                                    │
│ Progress: 60%                                                        │
│ Owner: agent | Created: 2026-03-31 14:20:05                          │
└──────────────────────────────────────────────────────────────────────┘
```

## 数据结构

```typescript
interface Goal {
  goal_id: string;
  parent_goal_id?: string;
  title: string;
  description?: string;
  goal_type: "task" | "subtask" | "question" | "information_gap" | "verification" | "recovery";
  status: "pending" | "active" | "blocked" | "waiting_input" | "completed" | "failed" | "cancelled";
  priority: number;
  importance?: number;
  urgency?: number;
  dependencies?: string[];
  acceptance_criteria?: AcceptanceCriterion[];
  progress?: number;
  owner?: "agent" | "user" | "human_reviewer" | "system";
  deadline_at?: string;
  created_at?: string;
  updated_at?: string;
}
```

## 树构建算法

```typescript
function buildGoalTree(goals: Goal[]): Map<string | undefined, Goal[]> {
  const tree = new Map<string | undefined, Goal[]>();
  for (const goal of goals) {
    const children = tree.get(goal.parent_goal_id) ?? [];
    children.push(goal);
    tree.set(goal.parent_goal_id, children);
  }
  return tree;
}
```

`parent_goal_id === undefined` 为根节点。按 `priority` 排序子节点。

## 节点样式

| Status | 背景色 | 左侧标识 |
|---|---|---|
| `active` | 蓝色底纹 | ● 蓝 |
| `completed` | 绿色底纹 | ● 绿 |
| `pending` | 灰色底纹 | ● 灰 |
| `blocked` | 红色底纹 | ● 红 |
| `waiting_input` | 黄色底纹 | ● 黄 |
| `failed` | 深红底纹 | ● 深红 |
| `cancelled` | 灰色删除线 | ● 灰 + ~~ |

每个节点显示：
- Status 圆点
- Title（可点击选中）
- Priority 数字
- Progress 进度条（百分比）

## 交互

- **展开/折叠**：父节点左侧有 +/- toggle
- **Expand All / Collapse All**：顶部按钮
- **Filter**：按 status 过滤，隐藏不匹配的节点（保留匹配节点的祖先路径）
- **Search**：高亮匹配的 goal，自动展开其祖先节点
- **选中**：点击节点，底部 Detail Panel 更新
- **实时更新**：WS `goal.created` / `goal.updated` 事件触发树更新

## Detail Panel

选中 goal 后底部展开详情：

| 字段 | 显示方式 |
|---|---|
| title | 大标题 |
| goal_type + status + priority | 标签行 |
| description | 文本段落 |
| dependencies | goal_id 列表，可点击跳转 |
| acceptance_criteria | 复选框列表 |
| progress | 进度条 |
| importance / urgency | 数值 + 水平条 |
| owner | 标签 |
| deadline_at | 倒计时（如果未过期）/ 已过期标签 |
| created_at / updated_at | 相对时间 |

## 数据源

| 数据 | API |
|---|---|
| Goal 列表 | `GET /v1/sessions/:id` → `goals[]` |
| 实时更新 | WS `session:{id}` 通道的 `goal.created` / `goal.updated` 事件 |

## 组件

```
GoalTreePage
  ├── FilterBar (status filter + search)
  ├── GoalTreeGraph (递归渲染)
  │    └── GoalNode (单个节点)
  │         ├── StatusBadge
  │         ├── Progress bar
  │         └── ExpandToggle
  └── GoalDetailPanel
       ├── Acceptance criteria list
       ├── Dependency links
       └── Metadata display
```
