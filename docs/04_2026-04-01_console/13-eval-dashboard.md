# Eval 面板（FR-53）

## 页面路由

- `/evals` — Eval 运行列表
- `/evals/compare` — 对比视图

## Eval 列表页布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ Evaluation Runs                        [＋ New Eval Run] [Compare]   │
├──────────────────────────────────────────────────────────────────────┤
│ Filter: [Agent ▼] [Pass Rate ▼] [Date Range]                        │
├──────────────────────────────────────────────────────────────────────┤
│ ☐  │ Status │ Run ID  │ Agent   │ Cases │ Pass% │ Score │ Date     │
│ ☐  │  [OK]  │run_a01  │ planner │  20   │ 95.0% │ 0.92  │ 03-31    │
│ ☐  │  [OK]  │run_b02  │ planner │  20   │ 90.0% │ 0.88  │ 03-30    │
│ ☐  │  [!!]  │run_c03  │ coder   │  15   │ 73.3% │ 0.71  │ 03-29    │
│    │        │         │         │       │       │       │          │
│ ☑ run_a01  ☑ run_b02              [Compare Selected] [Delete]       │
├──────────────────────────────────────────────────────────────────────┤
│ Pass Rate Trend                                                      │
│ [Recharts LineChart: x=date, y=pass_rate]                           │
│  ─── planner ─── coder                                               │
│  - - - - - threshold 80%                                            │
│                                                                      │
│ [!] Regression alert: run_c03 dropped below 80% threshold           │
└──────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### EvalRunTable

Eval 运行列表：

| 列 | 字段 | 说明 |
|---|---|---|
| ☐ | — | 多选复选框，用于 Compare 和 Delete |
| Status | pass_rate | ≥ 90% 绿 OK，80-90% 黄 WARN，< 80% 红 ALERT |
| Run ID | `run_id` | 可点击展开详情 |
| Agent | `agent_id` | — |
| Cases | `case_count` | — |
| Pass% | `pass_rate` | 百分比 + 进度条 |
| Avg Score | `average_score` | 数值 |
| Date | `started_at` | — |

**批量操作**：
- Compare Selected（勾选两条 → `/evals/compare?run_a=...&run_b=...`）
- Delete Selected（确认后批量删除）

### EvalTrendChart

通过率趋势图：

- **图表类型**：Recharts `<LineChart>`
- **X 轴**：日期
- **Y 轴**：pass_rate (0-100%)
- **线条**：按 agent_id 分组不同颜色
- **阈值线**：虚线，默认 80%（可配置）
- **数据来源**：从 `GET /v1/evals/runs` 返回的 runs 列表客户端排序生成

### RegressionAlert

当最新一次 run 的 pass_rate 低于阈值（默认 80%）时，显示醒目的警告横幅：

```
[!] Regression alert: run_c03 (coder) pass rate 73.3% dropped below 80% threshold
    2 cases regressed from previous run. [View Details →]
```

## Eval 详情展开

点击 Run ID 展开详情面板：

```
┌─run_c03──────────────────────────────────────────────────────────────┐
│ Agent: coder   Cases: 15   Pass: 11   Fail: 4   Score: 0.71        │
├──────────────────────────────────────────────────────────────────────┤
│ Case Results                                                         │
│ case_01: [PASS] score: 1.0   "Basic function call"                  │
│ case_02: [FAIL] score: 0.4   "Multi-tool chain"  ← failures: [...] │
│ case_03: [PASS] score: 0.85  "Error recovery"                       │
│ case_04: [FAIL] score: 0.3   "Approval flow"     ← failures: [...] │
│ ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

每个 case 显示：
- `case_id` + `description`
- passed/failed 彩色标签
- `score`
- `failures[]`（失败的断言列表，红色文字）
- 点击展开 → 完整 `EvalObservedResult`（session_id, step_count, tool_sequence, replay）

## Eval 对比页布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to Evals    Compare: run_a01 vs run_b02                      │
├──────────────────────────────────────────────────────────────────────┤
│ Summary                                                              │
│ Pass Rate: 95.0% → 90.0% (Δ -5.0%)                                 │
│ Avg Score: 0.92 → 0.88 (Δ -0.04)                                   │
│ Regressions: 1  │  Improvements: 0  │  Unchanged: 19                │
├─────────────────────────────┬────────────────────────────────────────┤
│ run_a01 (95.0%)             │ run_b02 (90.0%)                        │
├─────────────────────────────┼────────────────────────────────────────┤
│ case_01: [PASS] score: 1.0  │ case_01: [PASS] score: 1.0            │
│ case_02: [PASS] score: 0.9  │ case_02: [FAIL] score: 0.4  ← REG    │
│ case_03: [PASS] score: 0.85 │ case_03: [PASS] score: 0.88          │
│ case_04: [PASS] score: 0.92 │ case_04: [PASS] score: 0.90          │
│ ...                         │ ...                                    │
└─────────────────────────────┴────────────────────────────────────────┘
```

### 对比视图说明

- **左列**：Run A 的 case results
- **右列**：Run B 的 case results
- **REG 标记**：regression（A pass → B fail）红色高亮
- **IMP 标记**：improvement（A fail → B pass）绿色高亮
- **Summary 行**：pass_rate_delta, average_score_delta, 汇总计数

### New Eval Run 对话框

点击 "New Eval Run" 弹出：

```
┌─New Evaluation Run───────────────────────────────────────────────────┐
│ Agent: [planner ▼]                                                   │
│                                                                      │
│ Cases (JSON):                                                        │
│ [Monaco Editor: EvalCase[] JSON]                                    │
│                                                                      │
│ [Run] [Cancel]                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## 数据源

| 组件 | API |
|---|---|
| Run 列表 | `GET /v1/evals/runs` |
| Run 详情 | `GET /v1/evals/runs/:id` |
| 对比 | `GET /v1/evals/compare?run_a=...&run_b=...` |
| 趋势 | 客户端从 runs 列表排序生成 |
| 新建 | `POST /v1/evals/runs` |
| 删除 | `DELETE /v1/evals/runs/:id` |

实时更新：WS `evals` 通道推送 run 完成通知。

## 组件结构

```
EvalDashboardPage
  ├── EvalRunTable
  │    └── EvalRunRow (status badge, pass_rate bar)
  ├── EvalTrendChart (Recharts LineChart)
  ├── RegressionAlert (threshold banner)
  ├── CaseResultDetail (expandable per run)
  └── NewEvalRunDialog (Monaco Editor)

EvalComparePage
  ├── CompareSummary (delta metrics)
  ├── EvalCompareSideBySide
  │    ├── CaseColumn (run A)
  │    └── CaseColumn (run B, REG/IMP markers)
  └── CaseComparisonRow (per case, side by side)
```
