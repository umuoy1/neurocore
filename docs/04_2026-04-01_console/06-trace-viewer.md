# Cycle Trace 查看器（FR-52）

## 页面路由

`/sessions/:sessionId/traces`

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to Session    Traces: sess_abc123                            │
├──────────────────────────────────────────────────────────────────────┤
│ Cycle Timeline                                                       │
│ [====C1====][======C2======][===C3===][==C4==][===C5===]=> live     │
│   280ms       450ms          320ms     190ms    ? running            │
│ [selected: C3]                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ Cycle 3 — Phase Breakdown                                            │
│ [Perceive][  Propose  ][Evaluate][Decide][   Act    ][Learn]         │
│   40ms      80ms        50ms     30ms    100ms       20ms           │
│ [Stacked horizontal bar, proportional width]                         │
├──────────────────────────┬───────────────────────────────────────────┤
│ Proposal Competition     │ Prediction vs Observation                 │
│ Rank Module  Type  Score │ Predicted: "Return 3 fields"             │
│  1  reasoner action 0.88 │ Observed:  "Return 5 fields"             │
│  2  memory   recall 0.72 │ [WARNING] outcome_mismatch (low)         │
│  3  skill    match  0.65 │                                          │
│                          │ Prediction: "Cost ~$0.001"               │
│ [Score bar visualization]│ Observed:  "$0.0008"                     │
│                          │ [OK] no significant error                 │
├──────────────────────────┴───────────────────────────────────────────┤
│ Action Detail                                                        │
│ Type: call_tool  Tool: search_web  Side Effect: none                 │
│ Args: { "query": "Q1 sales data" }                                  │
│ Execution: succeeded in 98ms, cost $0.0008                          │
│                                                                      │
│ [View Full Workspace Snapshot]                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### CycleTimeline

横向时间轴，每段代表一个 cycle：

- **宽度**：按 `metrics.total_latency_ms` 比例分配
- **颜色**：completed=蓝, running=绿(脉冲动画), failed=红
- **Tooltip**：hover 显示 cycle_id、duration、cycle 序号
- **选中态**：高亮边框，下方面板更新
- **实时**：新 cycle 通过 WS 追加到右侧

**数据源**：`GET /v1/sessions/:id/replay` → `traces[]` 提取 `trace.started_at`, `trace.ended_at`, `trace.metrics.total_latency_ms`

### PhaseBarChart

选中 cycle 后显示的阶段分解条：

```
[Perceive][  Propose  ][Evaluate][Decide][   Act    ][Learn]
```

- **堆叠水平条形图**，每段宽度按阶段耗时比例
- **颜色编码**：Perceive=青, Propose=蓝, Evaluate=紫, Decide=橙, Act=绿, Learn=粉
- **Tooltip**：hover 显示阶段名和耗时

**阶段耗时推算**：从 `CycleTraceRecord` 各组件的时间戳推算：
- Perceive: `trace.started_at` 到第一个 `proposal.timestamp`
- Propose: proposals 生成时间窗口
- Evaluate: workspace 构建时间
- Decide: meta decision 时间
- Act: `action_execution.started_at` → `ended_at`
- Learn: observation 记录时间

### ProposalCompetitionTable

来自 `WorkspaceSnapshot.competition_log.entries[]`：

| 列 | 字段 | 说明 |
|---|---|---|
| Rank | `entry.rank` | 排名数字 |
| Module | `entry.module_name` | reasoner / memory / skill |
| Type | `entry.source` | action / recall / match |
| Salience | `entry.raw_salience` | 数值 + 水平条 |
| Weight | `entry.source_weight` | 数值 + 水平条 |
| Alignment | `entry.goal_alignment` | 数值 + 水平条 |
| **Final Score** | `entry.final_score` | 数值 + 加粗水平条，winner 高亮 |

底部显示 `competition_log.conflicts[]` 和 `selection_reasoning`。

### PredictionComparison

来自 `CycleTraceRecord.predictions[]` + `prediction_errors[]` + `observation`：

每个 prediction 与对应 observation 对比：
- **predicted_outcome** vs **observation.summary**
- **estimated_cost** vs **actual cost**（从 action_execution.metrics）
- **success_probability** vs **actual result status**
- **side_effects** predicted vs **actual side_effects**

每个对比项显示：
- ✅ 匹配（绿色）
- ⚠️ 轻微偏差（黄色）— severity: low
- ❌ 重大偏差（红色）— severity: high

类型：`outcome_mismatch`, `cost_mismatch`, `duration_mismatch`, `side_effect_mismatch`, `precondition_mismatch`

### ActionDetailPanel

展示 `CycleTraceRecord.selected_action` + `action_execution`：

| 字段 | 说明 |
|---|---|
| action_type | respond / call_tool / delegate 等 |
| title + description | 行动描述 |
| tool_name + tool_args | 工具调用详情（如果是 call_tool） |
| side_effect_level | none / low / medium / high |
| execution status | succeeded / failed / cancelled |
| latency_ms | 执行耗时 |
| cost | 执行成本 |
| input_tokens / output_tokens | Token 消耗 |

底部按钮 "View Full Workspace Snapshot" → `/sessions/:id/workspace/:cycleId`

### ObservationPanel

展示 `CycleTraceRecord.observation`：

| 字段 | 说明 |
|---|---|
| source_type | tool / user / system / memory / runtime |
| status | success / partial / failure / unknown |
| summary | 观察摘要 |
| confidence | 置信度 |
| side_effects | 副作用列表 |
| structured_payload | JSON 树展示 |

## 数据源

| 组件 | API |
|---|---|
| Timeline | `GET /v1/sessions/:id/replay` → `traces[]` |
| Phase Breakdown | 推算自 `CycleTraceRecord` 时间戳 |
| Competition | `WorkspaceSnapshot.competition_log` (from replay data) |
| Predictions | `CycleTraceRecord.predictions[]` |
| Prediction Errors | `CycleTraceRecord.prediction_errors[]` |
| Action | `CycleTraceRecord.selected_action` + `action_execution` |
| Observation | `CycleTraceRecord.observation` |
| Workspace | `GET /v1/sessions/:id/workspace/:cycleId` |

## 交互

- 点击 timeline 上的 cycle → 更新所有下方面板
- 点击 proposal 行 → 展开完整 proposal payload（侧边抽屉）
- 点击 prediction → 展开完整 prediction 详情
- "View Full Workspace" → 跳转 Workspace Inspector 页面
- 实时 session 时新 cycle 自动追加到 timeline 右侧
