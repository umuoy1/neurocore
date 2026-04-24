# 下一代记忆系统代码优先实施总计划

> 日期：2026-04-24
> 上位规格：[`06_next-generation-memory-system-design.md`](./06_next-generation-memory-system-design.md)
> 目标：把正式架构规格压缩成后续可直接写代码的实施单。本文档之后，记忆系统不再新增设计文档，后续工作全部转入代码实现与回归验证。
>
> 2026-04-24 实施回写：
> - Phase 0 ~ Phase 6 当前阶段已完成。
> - 当前代码已补齐：正式 `Episode` 真相层、`Memory Gate + Recall Bundle`、`SemanticCard / ProceduralSkillSpec` 正式对象、episode→card/spec 的 `suspect / tombstone / rollback` 治理传播、`memory-objective-benchmark / memory-causal-regression` 两条确定性评测，以及 Recall Bundle 对 `parametric_unit_refs` 的汇聚。
> - 本文档后续只维护“已完成 / 非目标 / 后续增强”边界，不再作为待施工清单。

---

## 1. 实施目标

后续实施只做一件事：把下一代记忆系统从“当前四层记忆 + SQL-first persistence + skill/RL/autonomy 已有闭环”推进到正式规格定义的主链：

1. 固化 `Runtime / Durable` 边界
2. 完整实现 `Episodic` 真相层
3. 引入 `Memory Gate + Recall Bundle`
4. 把 `Semantic Card` 和 `Skill Spec` 升级为正式对象
5. 打通删除、回滚、评测与 Console 可观测性
6. 在主链稳定后，才进入可选参数增益层

本计划不再讨论“要不要这样设计”，只定义“按什么顺序改、改哪些文件、如何验收”。

---

## 2. 当前代码基线

### 2.1 已有能力

当前仓库已经具备以下基础：

- `packages/memory-core`
  - `working-memory.ts`
  - `episodic-memory.ts`
  - `semantic-memory.ts`
  - `sqlite-working-memory-store.ts`
  - `sqlite-episodic-memory-store.ts`
  - `sqlite-semantic-memory-store.ts`
- `packages/runtime-core`
  - `runtime/agent-runtime.ts`
  - `cycle/cycle-engine.ts`
  - `trace/trace-recorder.ts`
  - `persistence/sqlite-memory-persistence.ts`
  - `persistence/sqlite-runtime-state-store.ts`
  - `skill/procedural-memory-provider.ts`
  - `skill/skill-promoter.ts`
  - `skill/bandit-skill-policy.ts`
  - `skill/reward-computer.ts`
  - `skill/skill-transfer-engine.ts`
  - `skill/online-learner.ts`
- `packages/protocol`
  - `types.ts`
  - `interfaces.ts`
  - `events.ts`
- `packages/eval-core`
  - `longmemeval.ts`

### 2.2 当前真实缺口

相对于正式规格，当前主要缺口是：

1. `RuntimeStateStore` 与长期记忆的边界虽然方向已对，但缺少规格级约束字段与强一致口径
2. `Episode` 还没有正式承载：
   - `evidence_refs`
   - `artifact_refs`
   - `temporal_refs`
   - `causal_links`
   - 完整 `activation_trace`
   - `lifecycle_state`
3. 没有 `Memory Gate`
4. 没有 `Recall Bundle` 作为统一输出
5. `Semantic Memory` 还不是正式 `Semantic Card`
6. `Procedural Memory` 还没有被明确收敛成正式 `Skill Spec`
7. 删除传播、`suspect`、`tombstone` 的治理链还没打通
8. LongMemEval 已有，但 retrieval-first 之外的 objective / causal memory regression 还没补

---

## 3. 实施原则

### 3.1 不重写 runtime

所有能力必须挂接到现有：

- `AgentRuntime`
- `CycleEngine`
- `WorkspaceCoordinator`
- `TraceRecorder`
- `GoalManager`
- `RuntimeStateStore`

不允许新起第二套“记忆执行循环”。

### 3.2 先真相层，再抽象层，再增益层

顺序固定：

1. Episodic truth layer
2. Retrieval discipline
3. Semantic / Procedural formal objects
4. Governance
5. Evaluation
6. Parametric extension

### 3.3 先符号化闭环，再参数化扩展

在 `Semantic Card / Skill Spec / tombstone / suspect / rollback` 没打通之前，不进入 `Soft Prompt / LoRA` 主实施。

### 3.4 只接受可回归改造

每个 Phase 都必须：

- 有 focused test
- 有验收标准
- 能够独立回滚

---

## 4. 包与文件边界

### 4.1 必改包

- `packages/protocol`
- `packages/memory-core`
- `packages/runtime-core`
- `packages/eval-core`

### 4.2 可改但非首批

- `packages/console`
- `packages/sdk-core`
- `packages/runtime-server`

### 4.3 明确不在首批引入的新包

首批不新增新的 memory 包。  
下一代记忆系统优先在现有 `memory-core / runtime-core / protocol / eval-core` 内完成重构与扩展。

---

## 5. Phase 划分

后续实现拆为 6 个 Phase，必须按顺序推进。

### Phase 0：协议与 Schema 冻结

目标：

- 冻结正式对象和事件边界
- 为后续实现提供稳定类型

新增或修订类型：

- `Episode`
  - 新增 `evidence_refs`
  - 新增 `artifact_refs`
  - 新增 `temporal_refs`
  - 新增 `causal_links`
  - 新增 `activation_trace`
  - 新增 `lifecycle_state`
  - 新增 `schema_version`
- `ActivationTrace`
- `MemoryLifecycleState`
- `SemanticCard`
- `ProceduralSkillSpec`
- `MemoryRetrievalPlan`
- `MemoryRecallBundle`
- `MemoryWarning`

事件至少新增：

- `memory.retrieval_planned`
- `memory.retrieved`
- `memory.episode_activated`
- `memory.semantic_card_created`
- `memory.skill_spec_created`
- `memory.object_marked_suspect`
- `memory.object_tombstoned`
- `memory.rollback_applied`

主要文件：

- `packages/protocol/src/types.ts`
- `packages/protocol/src/interfaces.ts`
- `packages/protocol/src/events.ts`

验收：

- `protocol` 编译通过
- 新类型全部进入判别联合或明确接口
- 向后兼容字段保持 optional，不直接破坏当前调用方

### Phase 1：Episodic Truth Layer

目标：

- 把 `Episode` 扩展为正式真相对象
- 打通 SQL-first 持久化、索引和读写路径

实施内容：

1. 扩展 `sqlite-episodic-memory-store`
   - 增加新字段列
   - 必要的 JSON 列与索引
2. 扩展 `episodic-memory.ts`
   - 写入新的 evidence / artifact / causal 字段
   - 支持 lifecycle state
3. 让 `agent-runtime.ts` / `cycle-engine.ts`
   - 在 action / observation / trace 结束时填充正式 episode
4. 将 activation trace 写入存储，而不是仅在内存推断

主要文件：

- `packages/memory-core/src/episodic-memory.ts`
- `packages/memory-core/src/sqlite-episodic-memory-store.ts`
- `packages/runtime-core/src/runtime/agent-runtime.ts`
- `packages/runtime-core/src/cycle/cycle-engine.ts`
- `packages/runtime-core/src/trace/trace-recorder.ts`
- `packages/runtime-core/src/persistence/sqlite-memory-persistence.ts`

验收：

- episode 可持久化新字段
- tenant / session / tool / lifecycle 查询可用
- runtime 恢复不依赖 fat snapshot 记忆本体

### Phase 2：Memory Gate 与 Recall Bundle

目标：

- 让检索从“固定 provider 调用”收敛成“计划化检索”
- 统一记忆系统的运行时输出

实施内容：

1. 在 `runtime-core` 新增：
   - `memory/memory-gate.ts`
   - `memory/recall-bundle.ts`
2. `CycleEngine` 在记忆阶段改为：
   - 先生成 `MemoryRetrievalPlan`
   - 再按层分阶段检索
3. 统一返回 `MemoryRecallBundle`
4. `WorkspaceCoordinator` 改为消费 Recall Bundle，而不是依赖散乱 digest/proposal 集合

主要文件：

- `packages/runtime-core/src/cycle/cycle-engine.ts`
- `packages/runtime-core/src/workspace/workspace-coordinator.ts`
- `packages/runtime-core/src/meta/providers/evidence-provider.ts`
- `packages/runtime-core/src/meta/providers/task-provider.ts`
- `packages/runtime-core/src/meta/providers/reasoning-provider.ts`

新增文件建议：

- `packages/runtime-core/src/memory/memory-gate.ts`
- `packages/runtime-core/src/memory/default-memory-gate.ts`
- `packages/runtime-core/src/memory/recall-bundle.ts`

验收：

- 每轮都有 `MemoryRetrievalPlan`
- 检索路径支持摘要层 -> 经验层 -> 证据层
- Meta / Workspace 能看到统一 Recall Bundle

### Phase 3：Semantic Card / Skill Spec 正式对象化

目标：

- 把当前 semantic/procedural 从“实现形态”收敛成“正式对象”

实施内容：

1. `Semantic`
   - 将 `semantic-memory.ts` 重构为 card-first 模型
   - 支持 `source_episode_ids / counter_examples / freshness / decay_policy`
2. `Procedural`
   - 将 `procedural-memory-provider.ts` 明确对齐 `ProceduralSkillSpec`
   - `skill-promoter.ts` 输出正式 `Skill Spec`
   - `sqlite-skill-store.ts` 承载正式 skill spec 元数据
3. Reward / Policy / Transfer 接口继续挂接 `Skill Spec`

主要文件：

- `packages/memory-core/src/semantic-memory.ts`
- `packages/memory-core/src/sqlite-semantic-memory-store.ts`
- `packages/runtime-core/src/skill/procedural-memory-provider.ts`
- `packages/runtime-core/src/skill/skill-promoter.ts`
- `packages/runtime-core/src/skill/sqlite-skill-store.ts`
- `packages/runtime-core/src/skill/reward-computer.ts`
- `packages/runtime-core/src/skill/bandit-skill-policy.ts`
- `packages/runtime-core/src/skill/skill-transfer-engine.ts`

验收：

- semantic card 可独立查询、展示、删除
- skill spec 可独立查询、执行、评估、迁移
- 不启用参数增益层时，系统仍完整工作

### Phase 4：治理链与删除传播

目标：

- 让 delete / rollback / contamination 不再停留在 episode 本身

实施内容：

1. 增加 `suspect / tombstone / rollback` 状态传播
2. episode tombstone 时：
   - 标记相关 semantic cards
   - 标记相关 skill specs
   - 后续可停用 parametric refs
3. 在 runtime 恢复时检查 suspect 对象
4. 在 Console API 层暴露治理状态

主要文件：

- `packages/memory-core/src/episodic-memory.ts`
- `packages/memory-core/src/semantic-memory.ts`
- `packages/runtime-core/src/skill/procedural-memory-provider.ts`
- `packages/runtime-core/src/runtime/agent-runtime.ts`
- `packages/runtime-core/src/persistence/sqlite-memory-persistence.ts`

可能新增：

- `packages/runtime-core/src/memory/memory-governance.ts`

验收：

- episode tombstone 后派生对象进入 suspect
- suspect 对象可被查询
- rollback 不破坏 episode 真相层

### Phase 5：评测与回归

目标：

- 把 retrieval-first 和 causal/objective memory regression 固化到 eval-core

实施内容：

1. 保持 `LongMemEval` 为 retrieval 主线
2. 新增：
   - `agent-objective-memory` benchmark
   - `causal-memory-regression`
3. 保留 official bridge：
   - retrieval log export
   - hypothesis `jsonl` export
   - evaluator wrapper

主要文件：

- `packages/eval-core/src/longmemeval.ts`
- `packages/eval-core/src/index.ts`

新增文件建议：

- `packages/eval-core/src/memory-objective-benchmark.ts`
- `packages/eval-core/src/memory-causal-regression.ts`

验收：

- retrieval benchmark 可稳定跑
- objective / causal benchmark 有 deterministic fixture
- benchmark 结果可写入 artifact

### Phase 6：可选参数增益层

目标：

- 在主链稳定后，引入 `Soft Prompt / LoRA` 作为可选优化

前置条件：

- Phase 0 ~ 5 全部完成
- delete / suspect / rollback 已稳定
- evaluation 证明参数层有明确收益

实施内容：

1. `Semantic Card -> Soft Prompt` 绑定
2. `Skill Spec -> LoRA Adapter` 绑定
3. provenance / enable / disable / retrain 元数据
4. `CycleEngine` 在 Recall Bundle 基础上可激活 parametric unit

主要文件：

- `packages/runtime-core/src/skill/procedural-memory-provider.ts`
- `packages/runtime-core/src/cycle/cycle-engine.ts`
- `packages/memory-core/src/semantic-memory.ts`

说明：

这一阶段不做：

- base weight merge
- 默认在线反向传播
- 把小模型当唯一长期记忆体

---

## 6. 测试与验收要求

### 6.1 每个 Phase 都必须补 focused tests

建议测试文件：

- `tests/memory-episode-schema.test.mjs`
- `tests/memory-retrieval-plan.test.mjs`
- `tests/memory-recall-bundle.test.mjs`
- `tests/semantic-card-lifecycle.test.mjs`
- `tests/procedural-skill-spec.test.mjs`
- `tests/memory-governance-propagation.test.mjs`
- `tests/memory-objective-benchmark.test.mjs`
- `tests/memory-causal-regression.test.mjs`

### 6.2 回归最低要求

必须保证以下既有主链不回退：

- session restore
- checkpoint restore
- cross-session episodic recall
- procedural skill execution
- reward / policy / transfer 闭环
- LongMemEval 当前路径

---

## 7. 开发顺序建议

正式施工顺序固定为：

1. `protocol`
2. `memory-core episodic`
3. `runtime-core cycle/runtime/workspace`
4. `semantic / procedural formalization`
5. `governance`
6. `eval-core`
7. `console/runtime-server` 的可视化和接口补齐
8. `parametric extension`（如果前面全部稳定）

不要并行做 Phase 2 和 Phase 6。  
不要在 Phase 3 前提前上参数增益层。  
不要在治理链没打通前做大规模训练资产落盘。

---

## 8. 明确延期项

以下内容明确延期，不进入后续第一轮代码实现：

- `micro-LoRA` 瞬时适应
- KV cache persistence
- token 级 `kNN-LM` 插值
- 小模型作为唯一长期记忆体
- base weight merge
- 重型分布式存储依赖

这些只能在正式主链稳定后，以实验分支推进。

---

## 9. 结束条件

当以下条件全部满足时，记忆系统文档阶段结束，后续只做代码与验证：

1. `06` 规格文档稳定
2. 本实施计划稳定
3. Phase 0 ~ Phase 5 的改造路径明确到文件级
4. 延期项边界明确

当前以上四项已经满足。  
后续记忆系统工作全部转入代码实现、测试回归和 benchmark 跑数。
