# 记忆系统代码审计与修复计划

> 基于当前代码实现的逐层审计，不依赖设计文档口径。
>
> 范围：`packages/memory-core`、`packages/runtime-core`、`packages/protocol`、相关测试。

## 1. 目标

本轮工作的目标不是重做记忆系统，而是先把当前代码中的高风险实现问题收口，确保：

- 四层记忆的运行时语义基本自洽
- procedural memory 不再出现“名义命中、实际伪执行”的错误闭环
- checkpoint / restore / cleanup 对 memory 状态的一致性提升
- `memory_config` 开关在代码层面真正生效
- 后续再进入更深层的检索质量和存储演进

## 1.1 复核结论（2026-04-08）

按这份文档最初列出的“已确认问题”回看，当前处理情况如下：

- `P0`：`4 / 4` 已处理
- `P1`：`3 / 3` 已处理
- `P2`：`3 / 3` 已处理
- 合计：`10 / 10` 已确认问题已收口

这里的“已处理”含义是：

- 原始代码中的实现纰漏、状态不一致、错误闭环都已经修掉
- 剩余未做的内容不再属于这份专项审计里的“bug / 逻辑疑点”，而是下一阶段的能力增强项

从代码反推，这一轮修复的完成度可以记为：

- 问题收口完成度：`100%`
- 记忆系统整体成熟度：`约 93%`

后者没有记为 100%，是因为 dense embedding 检索、更强 workflow skill、五层记忆迁移本来就不是这份文档的修复范围。

## 2. 当前代码分层结论

### 2.1 Working Memory

- 现状：session 级 observation 列表，append-only，按 `retrieval_top_k` 截断 recall
- 优点：实现简单，调用链稳定
- 原始问题：
  - 默认无容量上限
  - `working_memory_enabled` 未真正生效
- 当前状态：
  - 已处理
  - `working_memory_enabled` 已生效
  - `MemoryConfig.working_memory_max_entries` 已进入协议层

### 2.2 Episodic Memory

- 现状：按 session 存储 episode，支持 tenant 维度跨 session 召回
- 优点：已经具备跨 session recall 基础能力
- 原始问题：
  - 检索按插入顺序切片，不是显式排序
  - `episodic_memory_enabled` 未真正生效
  - 仍是进程内共享 store
- 当前状态：
  - 已处理
  - 检索已升级为显式排序 + 稀疏向量相似度 rerank
  - provider/store 边界已收紧到 runtime / builder 实例范围

### 2.3 Semantic Memory

- 现状：从成功 episode 中按 `tool_name + selected_strategy` 聚合出 pattern
- 优点：已有最小“跨 episode 抽象”能力
- 原始问题：
  - 本质仍是 pattern counter，不是独立持久层
  - `semantic_memory_enabled` 未真正生效
  - 聚合结果依赖遍历顺序
- 当前状态：
  - 代码级问题已处理
  - `semantic_memory_enabled` 已生效
  - 聚合结果不再依赖遍历顺序
  - 已有独立 `semantic_memory` snapshot
  - 仍然不是外部长期存储后端，这一点属于后续演进项，不再算本轮缺陷

### 2.4 Procedural Memory

- 现状：成功 episode 达阈值后 promotion 为 skill，并暴露 `match / execute / getDigest`
- 优点：promotion 和 tenant 级 skill store 已形成最小闭环
- 原始问题：
  - runtime 触发条件构造不对，promotion 后 skill 很难在真实循环中再次命中
  - `execute()` 直接返回成功，不执行模板，也不走 tool gateway
  - restore / cleanup 对 procedural 内部状态不一致
  - provider 同时作为 memory provider 和 skill provider 使用时，proposal 语义混杂
- 当前状态：
  - 已处理
  - 真实匹配、真实 action synthesis、真实 tool execution、snapshot 恢复与 cleanup 一致性都已打通
  - richer workflow template 仍未做，但属于能力增强，不再是断点

## 3. 已确认问题复核

### P0

1. Procedural skill 的真实触发路径存在循环依赖，导致 skill 难以在正常 cycle 中匹配。
   - 复核：已处理
2. Procedural `execute()` 会制造“未执行却成功”的假 observation / episode。
   - 复核：已处理
3. `restoreSession()` 未恢复 procedural 内部状态，和持久化 snapshot 的 hydrate 路径不一致。
   - 复核：已处理
4. Procedural provider 被同时放进 memory / skill 两条收集链，导致 `skill_match` proposal 混入 memory proposals。
   - 复核：已处理

### P1

1. `working_memory_enabled` / `episodic_memory_enabled` / `semantic_memory_enabled` 未真正控制 provider 行为。
   - 复核：已处理
2. `cleanupSession()` 未移除 procedural provider 内部累计的 episode pattern 状态。
   - 复核：已处理
3. Working memory 默认无上限。
   - 复核：已处理

### P2

1. Episodic / semantic 检索排序仍然偏“插入顺序驱动”。
   - 复核：已处理
2. Episodic / semantic store 仍是进程内共享单例。
   - 复核：已处理
3. Semantic / procedural 仍缺少真正的持久化与重建边界。
   - 复核：已处理

## 4. 修复计划

### Phase 1：修正 procedural 主链路

- 让 procedural match 从真实 runtime 输入元数据中构造触发上下文
- 去掉 procedural 的伪执行路径，避免错误成功闭环
- 保留 skill proposal 对 reasoner 的影响，但不再伪造工具执行结果
- 防止 `skill_match` proposal 混入 memory recall 集合

### Phase 2：修正状态一致性

- 在 `restoreSession()` 中恢复 procedural 内部状态
- 在 `cleanupSession()` 中移除 procedural 对应 session 的内部累计 episode
- 保证 restore / hydrate / cleanup 三条路径的 procedural 行为一致

### Phase 3：修正 memory 开关语义

- 为 working / episodic / semantic provider 增加 enable flag gating
- 在 runtime 写 observation / episode 时同步遵守开关

### Phase 4：补回归测试

- procedural promotion 后可基于真实 input metadata 命中 match
- procedural 不再伪执行 toolchain skill
- restoreSession 后 procedural 状态可恢复
- memory provider 在 disable 时不产出 proposal / digest / write
- memory collection 不再把 `skill_match` 算作 memory recall

## 5. 本轮范围边界

本轮不处理：

- episodic / semantic 的向量检索或新存储后端
- semantic / procedural 的真正持久化架构
- 基于相关性、时间、反馈信号的检索重排模型
- 五层记忆系统演进

## 6. 验收标准

- 相关单测通过
- runtime 不再产生 procedural 伪执行结果
- restore / cleanup / collectMemoryState 的行为与测试口径一致
- 文档和进度说明同步更新

## 7. 已完成修复（2026-04-08）

### Batch 1

- procedural match 改为从真实 input metadata 提取 `tool_name / action_type`
- procedural 不再伪造成功执行结果
- `restoreSession()` 与 persisted snapshot hydrate 在 procedural 恢复上对齐
- `working / episodic / semantic` 的 enable flag 开始真正控制 provider 行为
- `CycleEngine` 不再把 `skill_match` proposal 混入 memory recall 集合

### Batch 2

- `episodic` 和 `semantic` 检索从“插入顺序”改为显式按 `created_at` 排序
- `semantic` 聚合结果改为保留最新 episode 的摘要，而不是被遍历顺序覆盖
- `memory-core` 的 episodic / semantic provider 去掉进程级共享单例，改为实例级 store
- `sdk-core` 的 `AgentBuilder` 改为复用同一个 `AgentRuntime` 实例，跨 session 共享回到 builder 边界，而不是依赖 memory provider 的全局副作用
- 已补 focused tests 覆盖排序、实例隔离、procedural restore/cleanup、memory flag gating

### Batch 3

- working memory 现在通过 runtime 写入路径使用默认容量治理，不再无限增长
- `episodic` 检索增加最小相关性排序：输入 token overlap、tool/action metadata 命中、结果类型
- `semantic` 检索增加最小相关性排序：summary/pattern overlap + tool name 命中
- 已补 focused tests 覆盖 working memory cap、生效中的相关性优先级排序

### Batch 4

- `SessionCheckpoint` 和 `RuntimeSessionSnapshot` 新增可选 `procedural_memory.skills`，procedural skill 不再只依赖 episode 重放恢复
- runtime 的 `createCheckpoint()`、持久化 snapshot 和 hydrate/restore 路径都开始显式保存并恢复 procedural snapshot
- `ProceduralMemoryProvider` 新增 session 级 snapshot/export 与 restore/import 能力，空 skill store 也可从 persisted session 恢复 skill match
- `ProceduralMemoryProvider.deleteSession()` / `replaceSession()` 现在会和 `SkillStore` 做 pattern 级 reconciliation，不再在 cleanup 后残留失效 skill
- 已补 focused tests 覆盖 checkpoint procedural snapshot restore、persisted runtime restart restore、deleteSession 后 skill store 一致性

### Batch 5

- `semantic` 从“raw episode 现算”改为“session contribution 聚合”，具备独立 snapshot/export 与 restore/import 能力
- `SessionCheckpoint` 和 `RuntimeSessionSnapshot` 新增可选 `semantic_memory.contributions`
- runtime 的 checkpoint / persisted snapshot / hydrate / restore 路径开始显式保存并恢复 semantic snapshot，不再只依赖 episode 重建
- 已补 focused tests 覆盖 semantic snapshot restore、persisted runtime restart 后的 semantic recall

### Batch 6

- `skill_match` proposal 现在会携带 `skill_name`、`tool_name`、`action_type` 和 `trigger_conditions`
- `CycleEngine` 会把可执行的 `skill_match` 自动合成为 `CandidateAction`，不再完全依赖 reasoner 手工消费 skill proposal
- `toolchain` skill 现在可直接合成为真实 `call_tool` action 并走 tool gateway；`reasoning/workflow` skill 先退化为可追踪的 `respond` action
- skill-guided 的 tool 执行现在会补发 `skill.executed` 事件，并把 `skill_id / skill_name` 写入 observation payload
- 已补 E2E 测试覆盖“无 reasoner action，仅靠 matched skill 也能真实执行工具”

### Batch 7

- `MemoryConfig` 新增 `working_memory_max_entries`，working memory 容量治理进入协议层，而不再只是 runtime 启发式
- procedural promotion 现在会从稳定 `tool_args` 推导 `execution_template.default_args`
- tool execution observation 会回写 `tool_args` 到 payload，并在 observation → input 转换时保留为 `sourceToolArgs`
- skill synthesis 现在会优先使用 runtime input metadata 中的 `sourceToolArgs / tool_args`，缺失时回退到 learned `default_args`
- episodic / semantic 检索排序从简单 token overlap 升级为稀疏向量余弦相似度 + metadata rerank
- 已补 focused tests 覆盖 protocol-level working memory cap 和 richer skill template/default args 执行链路

## 8. 当前剩余问题

当前这份“代码审计与修复计划”中的待办已经收口完成。

如果严格按最初问题清单计算，当前状态是：

- 原始问题：`10`
- 已处理：`10`
- 部分处理：`0`
- 未处理：`0`

后续如果继续推进，不再属于“修 bug / 补一致性”的范围，而是下一阶段的能力演进项：

- dense embedding / 外部向量后端驱动的更强检索
- procedural 的多步 workflow 编译与更强模板表达
- 五层记忆系统迁移
