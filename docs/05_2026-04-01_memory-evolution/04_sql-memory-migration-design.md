# NeuroCore SQL 记忆库迁移设计

> 版本：0.1 | 日期：2026-04-08
> 状态：施工设计稿
> 目标：替换当前 `RuntimeSessionSnapshot` 中的记忆 JSON 存储，建立规范化 SQL 记忆库

---

## 1. 背景

当前 SQLite 持久化仅保存：

```sql
runtime_sessions(session_id, snapshot_json, updated_at)
```

这意味着 `working / episodic / semantic / procedural` 四层记忆与 `goals / trace / approvals / checkpoints` 一起被序列化进单个 `snapshot_json`。该实现适合 session 恢复，但不适合作为长期记忆库，问题主要有：

- 大量重复存储同一轮对话、observation、episode 与 checkpoint
- 无法按记忆层独立查询、索引、清理和迁移
- tenant 级召回无法使用 SQL 索引，只能先 hydrate 再内存扫描
- snapshot 越大，读写放大越明显

目标不是继续优化 `snapshot_json`，而是把它降级为运行态恢复层，把记忆本体迁移为规范化 SQL 表。

---

## 2. 迁移目标

### 2.1 总体原则

- `RuntimeStateStore` 只负责恢复运行态
- 四层记忆进入独立 SQL 记忆库
- 先双写，再切读，最后瘦身 snapshot
- 迁移期间不破坏现有 `AgentRuntime` 闭环

### 2.2 目标分层

| 层 | 目标存储 | 说明 |
|---|---|---|
| Working | `working_memory_entries` | 当前 session 的短时 observation 记忆 |
| Episodic | `episodic_episodes` | action/observation 形成的原子 episode |
| Semantic | `semantic_patterns` + session contribution 表 | tenant 级语义模式与 session 级输入边界 |
| Procedural | `procedural_skills` + `procedural_skill_triggers` | 已编译技能与触发条件 |
| Runtime | `runtime_sessions` 或等价运行态表 | goals / approvals / checkpoints / traces 的恢复层 |

---

## 3. 目标 Schema

### 3.1 Working

```sql
CREATE TABLE working_memory_entries (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  relevance REAL NOT NULL
);

CREATE INDEX idx_working_session_sequence
  ON working_memory_entries(session_id, sequence DESC);
```

### 3.2 Episodic

```sql
CREATE TABLE episodic_episodes (
  episode_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  trigger_summary TEXT NOT NULL,
  goal_refs_json TEXT NOT NULL,
  context_digest TEXT NOT NULL,
  selected_strategy TEXT NOT NULL,
  action_refs_json TEXT NOT NULL,
  observation_refs_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_summary TEXT NOT NULL,
  valence TEXT,
  lessons_json TEXT,
  promoted_to_skill INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_episode_session_created
  ON episodic_episodes(session_id, created_at DESC, episode_id DESC);

CREATE INDEX idx_episode_tenant_created
  ON episodic_episodes(tenant_id, created_at DESC, episode_id DESC);
```

### 3.3 Semantic

最终目标为 `semantic_patterns + semantic_pattern_sources`。但为兼容当前 restore/delete 语义，迁移第一阶段先采用桥接结构：

```sql
CREATE TABLE semantic_patterns (
  tenant_id TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  relevance REAL NOT NULL,
  occurrence_count INTEGER NOT NULL,
  last_updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, pattern_key)
);

CREATE TABLE semantic_session_contributions (
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_episode_ids_json TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, pattern_key)
);
```

### 3.4 Procedural

```sql
CREATE TABLE procedural_skills (
  skill_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT,
  risk_level TEXT,
  execution_template_json TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE procedural_skill_triggers (
  skill_id TEXT NOT NULL,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_bool INTEGER,
  PRIMARY KEY (skill_id, field, operator, value_text, value_number, value_bool)
);
```

---

## 4. 迁移阶段

### Phase 0：骨架落地

- 新增 SQL schema 和 store 骨架
- 不替换现有 runtime 读写路径
- 保持 snapshot-only 行为不变

### Phase 1：双写 Working / Episodic

- `WorkingMemoryProvider` 和 `EpisodicMemoryProvider` 写入时同时写内存和 SQL
- 召回仍默认走内存
- 新增最小 CRUD 测试

### Phase 2：切换 Working / Episodic 召回

- session 内 working recall 直接查 SQL
- episodic session/tenant recall 直接查 SQL
- snapshot 中 `working_memory` 与 `episodes` 暂时保留，作为恢复兼容层

### Phase 3：迁移 Semantic / Procedural

- semantic provider 改写为 SQL upsert 和 SQL 聚合
- procedural skill store 改为 SQL
- restore/hydrate 优先从 SQL 恢复

### Phase 4：瘦身 Runtime Snapshot

- `RuntimeSessionSnapshot` 不再承担四层记忆主存储
- 只保留运行态恢复需要的最小字段
- checkpoint 迁移为独立恢复资产

---

## 5. 当前代码批次范围

当前进展：

- 已完成 `Phase 0`：设计文档、`SQLite Working / Episodic / Semantic / Skill` store 骨架、最小 CRUD 验证
- 已开始并完成 `Phase 1` 第一批：`WorkingMemoryProvider` 与 `EpisodicMemoryProvider` 的内存主读 + SQL 双写写路径
- 已开始并完成 `Phase 1` 第二批 / `Phase 2` 最小版本：`AgentRuntime` / `defineAgent()` 已可显式注入 SQLite memory persistence，且配置后 `working / episodic` 读路径切换为优先读取 SQL
- 已开始并完成 `Phase 2` 扩展：`SemanticMemoryProvider` 已可直接复用 SQLite persistence；`createSqliteMemoryPersistence()` 现已同时提供 `semantic` 与 `skillStore`，`AgentRuntime` 可在不显式传入 `skillStore` 的情况下恢复 SQLite-backed procedural skills
- 已开始并完成 `Phase 4` 第一批：配置 SQLite memory persistence 时，`RuntimeSessionSnapshot` 已不再强制携带 `working_memory / episodes / semantic_memory`，session reload 会优先从 SQL 记忆库恢复
- 已开始并完成 `Phase 4` 第二批：当 `episodic + skillStore` 都走 SQLite persistence 时，`RuntimeSessionSnapshot` 也不再携带 `procedural_memory`；lazy hydrate 会重建 procedural 的 session/pattern 索引，但不会在恢复阶段错误下调 tenant 级 skill
- 已开始并完成 `Phase 5` 第一批：新增 legacy `runtime_sessions.snapshot_json` 到 normalized memory tables 的 backfill helper，并通过 `memory_backfill_status` 保证只执行一次，不会在后续 runtime 初始化时反复覆盖 SQL 记忆库
- 已开始并完成 `Phase 6` 第一批：配置 SQLite memory persistence 时，`SessionCheckpoint` 也允许省略 `working / episodic / semantic / procedural` 四层记忆；`restoreSession()` 会优先读取 checkpoint 自身，缺失时回退到 SQL memory store
- 已开始并完成 `Phase 6` 第二批：新增独立 `SqliteCheckpointStore`；配置后 `RuntimeSessionSnapshot` 不再携带 `checkpoints`，checkpoint 资产改为独立 SQLite 表持久化，runtime / SDK 均已可显式接线并在重启后恢复 checkpoint 列表

本批次只做：

- 设计文档定稿
- `SQLite Working / Episodic / Semantic / Skill` store 骨架
- 对外导出与最小 CRUD 验证
- `working / episodic` provider 的 `append/write/replace/delete` 双写
- runtime / SDK 对 SQLite memory persistence 的显式接线
- 配置 persistence 时 `working / episodic` provider 的 SQL 读路径
- `semantic` provider 的 SQLite persistence 接线
- `procedural` 的 SQLite `skillStore` 接线与 runtime 重载验证
- `RuntimeSessionSnapshot` 的进一步瘦身，去除 `working / episodic / semantic / procedural` 的冗余快照字段
- legacy snapshot 到 normalized SQL memory tables 的一次性 backfill
- `SessionCheckpoint` 的首批瘦身，以及基于 SQL memory store 的 slim checkpoint restore
- 独立 `SqliteCheckpointStore` 与 `RuntimeSessionSnapshot.checkpoints` 的瘦身

---

## 6. 验收标准

- 新增 SQL store 可独立完成基本 `write / list / replace / delete`
- `SqliteSkillStore` 可完成 `save / get / list / findByTrigger / delete`
- 现有 `npm run build` 不回退
- 现有记忆系统主链路行为保持不变
- 配置 SQLite memory persistence 时，`RuntimeSessionSnapshot` 与 `SessionCheckpoint` 都可省略四层记忆字段且仍能完成 restore
- 配置独立 `SqliteCheckpointStore` 时，`RuntimeSessionSnapshot` 可省略 `checkpoints` 字段，且 runtime / SDK 重启后仍可读取 checkpoint 列表

---

## 7. 风险与约束

- 当前 `semantic` 和 `procedural` 在未启用 SQL persistence 的路径上仍保留 JSON 快照，这是兼容旧 restore 语义的过渡形态
- `SessionCheckpoint` 已支持 slim 形态，且可选迁移到独立 SQLite 表；但默认 `InMemoryCheckpointStore` 路径仍会把 checkpoint 资产挂在 runtime snapshot 下，旧快照兼容路径暂未删除
- 多 runtime 并发写同一 SQL 记忆库仍是后续问题，本设计暂不引入 CAS 或分布式锁
- 记忆库 schema 已开始替代 snapshot 责任，但切读前仍属于“并存态”
