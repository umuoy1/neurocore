# Workspace 检查器

## 页面路由

`/sessions/:sessionId/workspace/:cycleId`

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to Traces    Workspace: sess_abc123 / cycle_003              │
├──────────────────────────────────────────────────────────────────────┤
│ Context Summary                                                      │
│ "Agent is analyzing Q1 sales data. Working memory contains 5        │
│  relevant entries. Two goals are active. No world state updates."   │
├───────────────────────────┬──────────────────────────────────────────┤
│ Risk Assessment           │ Confidence / Budget Assessment          │
│ Risk: 0.32 [LOW]         │ Confidence: 0.87 [HIGH]                 │
│ Urgency: 0.15            │ "Strong pattern match..."                │
│ Uncertainty: 0.28        │                                         │
│ Impact: 0.45             │ Budget: Within limit [YES]              │
│ Summary: "Low risk..."   │                                         │
├───────────────────────────┴──────────────────────────────────────────┤
│ Active Goals (3)                                                     │
│ [goal_01: Generate report - active] [goal_03: Analyze - active]     │
│ [goal_05: Verify compliance - blocked]                               │
├──────────────────────────────────────────────────────────────────────┤
│ Memory Digest (5)            │ Skill Digest (2)                      │
│ mem_01: Sales Q1 (0.95)     │ skill_01: data_analysis (0.82)        │
│ mem_02: Growth 15% (0.88)   │ skill_02: trend_detect (0.75)         │
│ mem_03: Target (0.82)       │                                       │
├──────────────────────────────────────────────────────────────────────┤
│ Candidate Actions (3)                                                │
│ 1. [call_tool: search_web] "Search Q1 data" side_effect: none       │
│ 2. [respond] "Report current findings"  side_effect: none           │
│ 3. [delegate] "Delegate to data-agent"  side_effect: medium         │
│                                                                      │
│ Selected: #1 (proposal_id: prp_001)                                  │
│ Decision Reasoning: "Direct data retrieval is most efficient..."     │
├──────────────────────────────────────────────────────────────────────┤
│ Competition Log                                                      │
│ Rank Module   Source   Salience Weight Alignment Final  Score        │
│  1   reasoner reasoner  0.92    0.85    0.90     0.88   [WIN]       │
│  2   memory   memory    0.85    0.70    0.80     0.72               │
│  3   skill    skill     0.78    0.60    0.72     0.65               │
│                                                                      │
│ Conflicts: none                                                      │
│ Selection Reasoning: "Reasoner proposal scored highest..."           │
├──────────────────────────────────────────────────────────────────────┤
│ Policy Decisions (1)                                                 │
│ policy_name: tool_safety   level: info   target: action             │
│ reason: "search_web has no side effects"                             │
└──────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### ContextSummary

`workspace.context_summary` 文本展示，通常是一段 Agent 对当前上下文的自然语言总结。

### RiskConfidenceGauge

**Risk Assessment** (`workspace.risk_assessment`):

| 指标 | 颜色阈值 |
|---|---|
| risk | < 0.3 绿, 0.3-0.7 橙, > 0.7 红 |
| urgency | < 0.3 绿, 0.3-0.7 橙, > 0.7 红 |
| uncertainty | < 0.3 绿, 0.3-0.7 橙, > 0.7 红 |
| impact | < 0.3 绿, 0.3-0.7 橙, > 0.7 红 |

每个指标用圆弧仪表盘或水平进度条展示。

**Confidence Assessment** (`workspace.confidence_assessment`):
- confidence 数值（仪表盘）
- summary 文本

**Budget Assessment** (`workspace.budget_assessment`):
- within_budget 状态（YES 绿 / NO 红）

### Active Goals

`workspace.active_goals[]` — `GoalDigest` 列表：

每个 goal 显示为标签卡片：
- `goal_id` (可点击 → Goal Tree 页面)
- `title`
- `status` 彩色徽章

### Memory Digest / Skill Digest

`workspace.memory_digest[]`：
- `memory_type` 标签（working/episodic/semantic/procedural）
- `summary`
- `relevance` 水平条

`workspace.skill_digest[]`：
- `skill_id` + `name`
- `relevance` 水平条

### CandidateActionsList

`workspace.candidate_actions[]` — 所有候选行动：

每个行动卡片显示：
- 序号
- `action_type` 标签
- `title` + `description`
- `tool_name` + `tool_args`（如果是 call_tool）
- `side_effect_level` 标签（none/low/medium/high）
- `expected_outcome`

**Selected Action** 高亮显示：
- `workspace.selected_proposal_id` 对应的行动
- `workspace.decision_reasoning` 决策理由

### CompetitionLogTable

`workspace.competition_log`：

**Entries** (`entries[]`)：

| 列 | 字段 | 可视化 |
|---|---|---|
| Rank | `rank` | 数字 |
| Module | `module_name` | 文本 |
| Source | `source` | reasoner/memory/skill 标签 |
| Raw Salience | `raw_salience` | 数值 + 水平条 |
| Source Weight | `source_weight` | 数值 + 水平条 |
| Goal Alignment | `goal_alignment` | 数值 + 水平条 |
| Final Score | `final_score` | 数值 + **加粗** 水平条，winner 加 [WIN] 标记 |
| Fused With | `fused_with` | 关联的 proposal_id 列表 |

**Conflicts** (`conflicts[]`)：
- 涉及的 `proposal_ids`
- `conflict_type`（如 "overlapping_action"）
- `score_gap`

**Selection Reasoning**：文本展示

### PolicyDecisions

`workspace.policy_decisions[]`：

每个 decision 显示：
- `policy_name` — 策略名称
- `level` 彩色标签（info=蓝, warn=橙, block=红）
- `target_type` + `target_id`
- `reason`
- `recommendation`（如有）

## 数据源

| 组件 | API |
|---|---|
| 整个页面 | `GET /v1/sessions/:id/workspace/:cycleId` |

单一 API 调用返回完整 `WorkspaceSnapshot`，所有面板从 snapshot 字段派生。

## 交互

- 所有 ID 类字段可点击跳转（goal_id → Goal Tree, memory_id → Memory Inspector）
- Candidate action 行可点击展开完整 payload
- Competition log 行可 hover 显示详细分数分解
- Policy decision 行可展开 recommendation

## 与其他页面的关系

- **入口**：Trace Viewer 页面 → "View Full Workspace Snapshot" 按钮
- **Goal 跳转**：active_goals 中的 goal_id → Goal Tree 页面
- **Memory 跳转**：memory_digest 中的条目 → Memory Inspector 页面
