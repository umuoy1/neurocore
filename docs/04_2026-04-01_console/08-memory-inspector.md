# Memory 检查器

## 页面路由

`/sessions/:sessionId/memory`

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to Session    Memory: sess_abc123                            │
│ [Working] [Episodic] [Semantic] [Procedural]                        │
│ [Search...]                                  [Type filter ▼]        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Layer: Working Memory (12 entries)                                   │
│                                                                      │
│ ┌─mem_001─────────────────────────────────────────────────────────┐ │
│ │ Sales Q1 = $1.2M                            relevance: 0.95    │ │
│ │ source: observation       created: 14:20:05                    │ │
│ │ [████████████████████░░░░░] 0.95                               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ ┌─mem_002─────────────────────────────────────────────────────────┐ │
│ │ Target growth 15%                           relevance: 0.88    │ │
│ │ source: observation       created: 14:20:12                    │ │
│ │ [██████████████████░░░░░░░] 0.88                               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ ...                                                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 四层视图

### Working Memory

简单的 `WorkingMemoryRecord` 列表，按 relevance 降序排列。

每条记录显示：
- `summary`（主要文本）
- `relevance`（数值 + 水平进度条）
- `memory_id`（可复制）

数据源：`GET /v1/sessions/:id` → `working_memory[]`

### Episodic Memory

时间线视图，按 `created_at` 降序排列的 `Episode` 列表。

每条记录显示：
- `trigger_summary`（触发摘要）
- `selected_strategy`（选中的策略）
- `outcome` 彩色标签（success=绿, partial=黄, failure=红）
- `outcome_summary`（结果摘要）
- `valence` 指示器（positive=↑, neutral=→, negative=↓）
- `lessons[]`（教训列表，折叠显示）
- `promoted_to_skill` 徽章（如已提升为技能）
- `goal_refs[]`（关联的 goal ID 列表）
- `action_refs[]` + `observation_refs[]`

可按 `outcome` 筛选。

数据源：`GET /v1/sessions/:id/episodes`

### Semantic Memory

聚合视图，按 `pattern_key` 分组的 `SemanticMemoryRecord`。

每条记录显示：
- `summary`（模式摘要）
- `pattern_key`（分组键）
- `occurrence_count`（出现次数，决定视觉大小）
- `source_episode_ids[]`（来源 episode 列表）
- `session_ids[]`（跨 session 来源）
- `relevance`（相关性分数）
- `last_updated_at`

以集群方式展示：相同 `pattern_key` 的记录聚合在一起，`occurrence_count` 越大视觉面积越大。

数据源：`GET /v1/sessions/:id/memory/semantic`（新端点）

### Procedural Memory

`SkillDefinition` 网格视图。

每张卡片显示：
- `name` + `version`
- `kind` 标签（reasoning_skill / workflow_skill / toolchain_skill / compiled_skill）
- `trigger_conditions[]`（触发条件列表）
- `risk_level` 标签（low / medium / high）
- `applicable_domains[]`
- 点击展开显示 `execution_template` 详情

数据源：`GET /v1/sessions/:id/skills`（新端点）或从 `workspace.skill_digest` 推断

## 交互

- **Tab 切换**：Working / Episodic / Semantic / Procedural
- **搜索**：全文本搜索 summary 字段
- **筛选**：按 memory_type / outcome (episodic) / kind (procedural)
- **排序**：按 relevance / created_at / occurrence_count
- **点击展开**：卡片展开显示完整详情

## 组件结构

```
MemoryInspectorPage
  ├── MemoryLayerTabs
  ├── MemorySearchBar
  ├── WorkingMemoryView
  │    └── MemoryEntryCard (relevance bar)
  ├── EpisodicTimeline
  │    └── EpisodeCard (outcome badge, valence, lessons)
  ├── SemanticClusterView
  │    └── SemanticClusterCard (occurrence count, pattern_key)
  └── ProceduralGrid
       └── SkillCard (kind badge, risk_level, trigger_conditions)
```

## 数据源汇总

| Layer | API | 实时更新 |
|---|---|---|
| Working | `GET /v1/sessions/:id` → `working_memory[]` | WS `session:{id}` → `memory.written` 事件 |
| Episodic | `GET /v1/sessions/:id/episodes` | WS `session:{id}` → `memory.written` 事件 |
| Semantic | `GET /v1/sessions/:id/memory/semantic` (新增) | — |
| Procedural | `GET /v1/sessions/:id/skills` (新增) | WS `session:{id}` → `skill.promoted` 事件 |
