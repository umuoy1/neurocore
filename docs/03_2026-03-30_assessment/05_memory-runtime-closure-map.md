# 记忆系统代码反推：模块关系图与生命周期图

> 只基于当前代码实现反推，不引用设计文档目标口径。
>
> 范围：`packages/runtime-core`、`packages/memory-core`、`packages/protocol`。

## 1. 结论

当前记忆系统在代码层面已经形成完整闭环：

- `working / episodic / semantic / procedural` 四层都已进入 runtime 主链路
- `skill_match -> candidate action -> tool execution -> observation -> episode -> skill promotion` 已打通
- `checkpoint / restore / persisted snapshot hydrate / cleanup` 四条路径已经能保持 memory 状态基本一致

它当前的真实定位不是“大规模长期记忆底座”，而是“单 runtime 内自洽、支持跨 session 经验复用与恢复的记忆内核”。

## 2. 模块关系图

### 2.1 主关系

```text
AgentRuntime
  -> CycleEngine
     -> MemoryProviders
        -> WorkingMemoryProvider
        -> EpisodicMemoryProvider
        -> SemanticMemoryProvider
        -> ProceduralMemoryProvider
     -> SkillProviders
        -> ProceduralMemoryProvider
     -> Reasoner
     -> MetaController
  -> ToolGateway
  -> GoalManager
  -> SessionManager
  -> TraceRecorder
  -> CheckpointStore
  -> RuntimeStateStore
```

### 2.2 四层记忆的真实职责

- `working`
  - 当前 session 内的 observation 派生短时项
  - 只参与当前 session recall
- `episodic`
  - 每次 action + observation 固化成 `Episode`
  - 支持 session 内和 tenant 维度跨 session recall
- `semantic`
  - 从 success episode 中提取 session contribution
  - 跨 session 汇总为 repeated pattern 的抽象记忆
- `procedural`
  - 从 repeated success episode promotion 为 `SkillDefinition`
  - 既参与 memory digest，也参与 skill match 与 action synthesis

### 2.3 关键代码锚点

- runtime 编排：[agent-runtime.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/runtime/agent-runtime.ts)
- cycle 收集：[cycle-engine.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/cycle/cycle-engine.ts)
- working：[working-memory.ts](/Users/sizz/Code/neurocore/packages/memory-core/src/working-memory.ts)
- episodic：[episodic-memory.ts](/Users/sizz/Code/neurocore/packages/memory-core/src/episodic-memory.ts)
- semantic：[semantic-memory.ts](/Users/sizz/Code/neurocore/packages/memory-core/src/semantic-memory.ts)
- procedural：[procedural-memory-provider.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/skill/procedural-memory-provider.ts)
- skill promotion：[skill-promoter.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/skill/skill-promoter.ts)
- tool execution：[tool-gateway.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/execution/tool-gateway.ts)

## 3. 一次运行的生命周期

### 3.1 标准运行闭环

```text
UserInput
  -> AgentRuntime.runOnce()
  -> decomposeGoals()
  -> CycleEngine.run()
     -> collectMemoryState()
     -> collectSkillState()
     -> reasoner.plan()
     -> reasoner.respond()
     -> synthesizeSkillActions()
     -> metaController.evaluate()
  -> executeSelectedAction()
  -> recordObservation()
  -> persistEpisode()
  -> maybeCreateCheckpoint()
  -> persistSessionState()
```

### 3.2 读路径

#### Working

```text
Observation
  -> WorkingMemoryProvider.appendObservation()
  -> WorkingMemoryStore
  -> retrieve()/getDigest()
  -> memory_recall proposal + memory_digest
```

#### Episodic

```text
Observation + Action
  -> persistEpisode()
  -> EpisodicMemoryProvider.writeEpisode()
  -> EpisodicMemoryStore
  -> session recall / tenant recall
  -> memory_recall proposal + episodic digest
```

#### Semantic

```text
Success Episode
  -> SemanticMemoryProvider.writeEpisode()
  -> session contribution update
  -> cross-session aggregate on retrieve()
  -> semantic memory_recall proposal + semantic digest
```

#### Procedural

```text
Success Episode
  -> ProceduralMemoryProvider.writeEpisode()
  -> pattern accumulation
  -> threshold reached
  -> compileSkillFromEpisodes()
  -> SkillStore.save()
  -> later match()
  -> skill_match proposal
  -> synthesizeSkillActions()
  -> real CandidateAction
```

### 3.3 procedural 的真实执行闭环

这是当前最关键的一条链。

```text
Success Episodes
  -> pattern accumulation
  -> promotion -> SkillDefinition
  -> match() using current input metadata
  -> skill_match proposal
  -> CycleEngine synthesizes CandidateAction
  -> AgentRuntime.executeSelectedAction()
  -> ToolGateway.execute() for toolchain skill
  -> Observation
  -> persistEpisode()
  -> new success episode feeds back into procedural memory
```

当前实现里：

- `toolchain` skill 会被合成为真实 `call_tool` action
- learned `default_args` 会进入 synthesized action
- observation payload 会带回 `tool_name / tool_args / skill_id / skill_name`
- 下一轮继续运行时，这些信息又会通过 `observationToInput()` 回流成新的 input metadata

## 4. checkpoint / restore / persisted hydrate 生命周期

### 4.1 Checkpoint 生成

```text
createCheckpoint(sessionId)
  -> session
  -> goals
  -> working/episodic/semantic/procedural
     -> 仅在未启用 SQL memory persistence 时内嵌进 checkpoint
  -> traces
  -> checkpointStore.save()
```

### 4.2 restoreSession(checkpoint)

```text
checkpoint
  -> SessionManager.hydrate()
  -> GoalManager.hydrate()
  -> WorkingMemoryProvider.replace()
  -> EpisodicMemoryProvider.replace()
  -> SemanticMemoryProvider.replaceSession()
  -> SemanticMemoryProvider.restoreSnapshot()
  -> ProceduralMemoryProvider.replaceSession()
  -> ProceduralMemoryProvider.restoreSnapshot()
  -> TraceStore.replaceSession()
  -> persistSessionState()
```

### 4.3 persisted session hydrate

```text
RuntimeStateStore.getSession()/listSessions()
  -> hydratePersistedSession(snapshot)
  -> validate slim runtime snapshot
  -> reject legacy fat snapshot payload
  -> restore session/goals/traces/approvals
  -> working/episodic/semantic/procedural 从 SQL persistence 侧恢复或按需读取
  -> checkpoints 从独立 checkpoint store 恢复
```

### 4.4 cleanup

```text
cleanupSession(sessionId)
  -> delete goals
  -> delete working memory
  -> delete episodic memory
  -> delete semantic memory
  -> delete procedural memory + skill reconciliation
  -> delete traces/checkpoints/predictions/events
  -> delete session
  -> delete persisted snapshot
```

## 5. 状态边界

### 5.1 session 级状态

- `working_memory`
- `episodes`
- `semantic contributions`
- `procedural accumulated episodes`
- `traces`
- `approvals / pending approvals`

### 5.2 tenant 级状态

- `episodic` 的跨 session recall 作用域
- `semantic` 的 cross-session aggregate 作用域
- `procedural` 的 `SkillStore` 与 pattern group 作用域

### 5.3 persisted 边界

当前 persisted 边界已经拆成两层：

- `RuntimeSessionSnapshot`
  - `session`
  - `goals`
  - `trace_records`
  - `approvals / pending_approvals`
- SQL memory/checkpoint stores
  - `working_memory`
  - `episodes`
  - `semantic_memory`
  - `procedural_memory`
  - `checkpoints`

legacy fat runtime snapshot 现在只属于迁移输入，不再是 runtime 可直接消费的恢复格式。

## 6. 代码反推下的系统性质

### 6.1 为什么说它已经闭环

- 所有 memory layer 都进入了 runtime 主循环
- 读路径和写路径都存在
- promotion/match/execute/writeback 已形成回路
- restore / hydrate / cleanup 已覆盖同一组 memory state

### 6.2 为什么说它还不是终局形态

- episodic / semantic 检索仍是内存扫描 + 排序
- semantic / procedural 是本地派生状态，不是外部长期存储引擎
- procedural 的 workflow 模板仍未形成更强执行器
- 仍以单 runtime / 单进程一致性为主，不是分布式记忆系统

## 7. 最终判断

从代码真实行为反推，当前记忆系统是：

- **闭环的**：是
- **工程可用的**：是
- **当前阶段足够高效的**：是
- **极简的**：不是
- **面向长期大规模记忆的终局方案**：不是

更准确的描述是：

> 这是一个已经收口的 runtime memory kernel，适合当前产品阶段继续承载功能演进；后续需要提升的，不再是“补断点”，而是“换更强的长期记忆基础设施”。
