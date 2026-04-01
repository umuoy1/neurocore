# World Model 查看器

## 页面路由

`/world`

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ World Model                                   [Query] [Refresh]      │
├──────────────────────────────────────────────────────────────────────┤
│ Filters: [Entity Type ▼] [Min Confidence ▼] [Max Age ▼]            │
│          [Relation Type ▼] [Session: ▼]                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Entity-Relation Graph                                                │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │                                                                  │ │
│ │     [Entity:A]                                                   │ │
│ │      /        \                                                  │ │
│ │  contains    located_in                                          │ │
│ │    /            \                                                │ │
│ │ [Entity:B]   [Entity:C] ──interacts_with── [Entity:D]           │ │
│ │                                                                  │ │
│ │ (Force-directed layout, nodes sized by confidence)               │ │
│ │ (Click node = select, shows detail panel on right)               │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
├──────────────────────────┬───────────────────────────────────────────┤
│ Entity: Entity_A         │ Relations (2)                             │
│ Type: region             │ → contains (Entity:B) str: 0.9           │
│ Confidence: 0.95         │ → located_in (Entity:C) str: 0.85        │
│ Last Observed: 14:20:05  │                                           │
│ TTL: 300s                │ Conflicts (0)                             │
│ Properties:              │ No conflicts detected                     │
│   name: "Building Alpha" │                                           │
│   capacity: 150          │                                           │
│   status: "occupied"     │                                           │
└──────────────────────────┴───────────────────────────────────────────┘
```

## 实体-关系图可视化

使用力导向图（force-directed graph）布局：

**节点（Entity）**：
- 大小：按 `confidence` 缩放
- 颜色：按 `entity_type` 分配（自动配色）
- 标签：显示 `entity_id` 或 `properties.name`
- 点击选中 → 右侧面板更新

**边（Relation）**：
- 标签：`relation_type`
- 颜色：按 `strength` 渐变（浅→深）
- 粗细：按 `confidence`
- 方向箭头：`source_entity_id` → `target_entity_id`

**布局**：
- 力导向自动布局
- 可拖拽节点重新排列
- 缩放和平移

## 查询过滤

`WorldStateQuery` 参数：

| 参数 | 说明 | UI 控件 |
|---|---|---|
| `entity_type` | 过滤实体类型 | 下拉选择（从当前数据聚合可选项） |
| `relation_type` | 过滤关系类型 | 下拉选择 |
| `min_confidence` | 最低置信度 | 滑块 (0-1) |
| `max_age_ms` | 最大年龄 | 下拉（5m / 15m / 1h / 全部） |
| `session_id` | 选择 Session | 下拉（从 sessions store 获取） |

过滤后，图仅显示匹配的 entity 和它们之间的 relation。

## 实体详情面板

选中 entity 后右侧显示：

| 字段 | 说明 |
|---|---|
| entity_id | 唯一标识 |
| entity_type | 类型标签 |
| confidence | 数值 + 颜色指示 |
| last_observed | 相对时间 |
| ttl_ms | 剩余 TTL 倒计时 |
| properties | JSON 树展示（`JsonViewer` 组件） |
| source_percept_ids | 来源感知 ID 列表 |

关联的 Relations 列表：
- 方向（出/入）
- `relation_type`
- 对端 entity_id（可点击跳转选中）
- `strength` + `confidence`

## 冲突列表

显示 `world_state.conflict_detected` 和 `world_state.conflict_resolved` 事件：

每条冲突显示：
- 冲突类型
- 涉及的 entities/relations
- 状态：detected（红）/ resolved（绿）
- 时间戳

## 数据源

| 数据 | API | 说明 |
|---|---|---|
| 实体与关系 | `GET /v1/sessions/:id/world-state` (新增) | 返回 `{ entities, relations }` |
| 实时更新 | WS `world:{session_id}` | `WorldStateDiff` 增量 |

**增量更新处理**：

```typescript
function applyDiff(state: WorldState, diff: WorldStateDiff): WorldState {
  // 移除
  for (const id of diff.removed_entity_ids) {
    state.entities.delete(id);
  }
  // 新增
  for (const entity of diff.added_entities) {
    state.entities.set(entity.entity_id, entity);
  }
  // 更新
  for (const { entity_id, changes } of diff.updated_entities) {
    Object.assign(state.entities.get(entity_id), changes);
  }
  // relations 同理
  return state;
}
```

## 交互

- **拖拽**节点重新布局
- **缩放/平移**整个图
- **点击节点**选中 → 右侧面板更新
- **点击边**选中 → 显示 relation 详情
- **双击节点**居中放大
- **Filter 变更** → 图重新渲染
- **实时**：WS 推送 diff → 图增量更新（新增节点淡入，移除节点淡出）

## 组件结构

```
WorldModelViewerPage
  ├── WorldStateQueryBar (filter controls)
  ├── EntityRelationGraph (force-directed SVG)
  │    ├── EntityNode (circle + label)
  │    └── RelationEdge (line + label + arrow)
  ├── EntityDetailPanel (properties, confidence, TTL)
  │    └── JsonViewer (properties)
  ├── RelationDetailPanel
  └── ConflictList (detected/resolved events)
```

## 技术选型

力导向图使用 `react-force-graph-2d` 或自定义 SVG + `d3-force`。优先选择轻量方案，避免引入大型图谱库。
