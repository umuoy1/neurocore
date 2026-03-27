# MVP 差距分析与下一步目标

> 基于 2026-03-27 代码状态，对照 `agent_sdk_mvp_implementation_plan.md` 的 MVP 定义精确评估。

## 1. MVP 条件逐条对照

MVP 要求满足以下 6 个条件：

| # | 条件 | 状态 | 说明 |
|---|---|---|---|
| 1 | 开发者可以定义 Agent | ✅ 完成 | `defineAgent()` 完整可用 |
| 2 | Session 可以创建、恢复、完成 | ✅ 完成 | 含 resume、goal rebase，已有测试 |
| 3 | Runtime 可以执行标准认知周期 | ✅ 完成 | `CycleEngine` 全链路打通 |
| 4 | Agent 可使用目标栈、工具、工作记忆和情景记忆 | ✅ 完成 | 均有实现，记忆已接入 cycle |
| 5 | 高风险动作有基础门控 | ⚠️ 部分 | policy 只 warn 不 block，approval 流程存在但无测试覆盖 |
| 6 | 运行过程可追踪、可回放、可评估 | ✅ 完成 | Trace / Replay / EvalRunner 均可用 |

## 2. MVP 必须交付清单对照

| 交付物 | 状态 | 问题 |
|---|---|---|
| Protocol Schema | ✅ | — |
| Agent Builder | ✅ | — |
| Session Runtime | ✅ | — |
| Goal Stack | ✅ | — |
| Workspace Snapshot | ✅ | budget check 是 stub（`actions.length < 20`） |
| Tool Gateway | ✅ | — |
| Working Memory | ✅ | — |
| Episodic Memory | ✅ | — |
| Meta Controller | ⚠️ | 只选第一个非 block action，confidence 固定 0.6 |
| Trace Store | ✅ | — |
| Replay Runner | ✅ | — |
| Eval Harness | ✅ | — |

## 3. MVP 验收场景覆盖情况

| 场景 | 状态 | 问题 |
|---|---|---|
| 复杂问答 + 澄清（ask_user 后 resume） | ⚠️ 无测试 | `ask_user` action type 存在，`waiting` 状态存在，但无端到端测试 |
| 多工具串联任务 | ❌ 无测试 | 现有测试只覆盖单工具单步调用 |
| 高风险工具审批 | ⚠️ 无测试 | approval 流程存在，但没有测试验证"高副作用 → 审批 → 继续执行"完整路径 |
| 长任务恢复 | ✅ 有测试 | `resume with explicit input rebases the active root goal` 覆盖 |
| 经验复用（历史 episode 影响决策） | ❌ 无测试 | episodic memory 有写入，但无测试验证 recall → reasoner 感知到记忆 |

## 4. TODO.md 中 MVP 相关未完成项

```
[ ] Replace heuristic budget checks with token/cost/tool quotas
[ ] Add configurable tool allow/deny policy bundles
[ ] Expand approval policy by tenant and risk level
[ ] Expose eval run creation on runtime-server
[ ] Persist eval reports and replay references
[ ] Add remote client bindings for eval APIs
```

---

## 5. 下一步目标（MVP 收尾）

以下 4 个目标完成后，MVP 可以宣告交付。

---

### 目标 A：补全门控路径（Policy + Budget）

**问题**：
- `DefaultPolicyProvider` 对高副作用 action 只返回 `warn`，MetaController 只过滤 `block` 级别，导致 warn 没有任何实际效果
- `BudgetAssessment` 只检查候选 action 数量，不是真实预算

**要做的**：

1. **Policy 分级修复**：`DefaultPolicyProvider` 对 `side_effect_level === "high"` 改为返回 `warn` + 同时在 MetaController 里把 warn 转化为 `request_approval`，而不是只靠 side_effect_level 判断。或者在 MetaController 里统一处理：warn 级别触发审批，block 级别拦截动作。

2. **Budget 替换**：`WorkspaceCoordinator.computeBudget` 改为基于 cycle 数量或 tool call 数量的简单 quota（不需要 LLM token 计费，cycle 数上限即可），删掉 `MVP budget check only validates candidate action count` 这行注释。

3. **Policy bundle 最小实现**：支持在 `defineAgent()` 时传入 `allowedTools` 和 `deniedTools` 列表，PolicyProvider 据此生成 block 决策。

**验收**：`side_effect_level: "high"` 的 tool action 触发审批流，policy block 的 tool 被真正拦截，超 quota 的 session 被终止。

---

### 目标 B：补全验收场景测试

写 4 个端到端测试，对应 MVP 计划中还未覆盖的场景。

**测试 B1：复杂问答 + 澄清**

场景：agent 返回 `ask_user`，session 进入 `waiting`，调用 `resume` 传入澄清信息后继续执行，最终 `completed`。

验收点：
- `first.finalState === "waiting"`
- `session.resume(...)` 后 `second.finalState === "completed"`
- trace 中包含 `ask_user` action 记录

**测试 B2：多工具串联任务**

场景：agent 第一步调用 `tool_a`，根据结果再调用 `tool_b`，最后 respond。

验收点：
- `result.steps` 包含两次 `call_tool`
- `replay().traces` 中 `executed_tool_sequence` 为 `["tool_a", "tool_b"]`
- 最终 `completed`

**测试 B3：高风险工具审批**

场景：agent 调用 `side_effect_level: "high"` 的 tool，session 进入 `escalated`，调用审批接口后继续执行。

验收点：
- 第一次 `run()` 后 `finalState === "escalated"`
- 调用 `session.approve(actionId)` 后继续执行到 `completed`
- tool 实际被调用（trace 中有 `action.executed`）

**测试 B4：经验复用**

场景：第一次 session 执行后 episode 被写入；第二次 session 的 reasoner 能在 `ctx.runtime_state.memory_recall_proposals` 里看到第一次的 episode。

验收点：
- 第一次 session 后 `episodicMemory.getEpisodes().length >= 1`
- 第二次 session 的 `plan()` 收到的 `ctx.runtime_state.memory_recall_proposals` 非空
- 两个 session 共用同一个 `EpisodicMemory` 实例

---

### 目标 C：Remote Eval API

**问题**：`runtime-server` 缺少 eval 入口，无法通过 HTTP 触发 eval run，报告也没有持久化。

**要做的**：

1. `POST /v1/evals` — 接受 `EvalCase[]`，异步执行 `EvalRunner.run()`，返回 `run_id`
2. `GET /v1/evals/:runId` — 查询 eval 报告（存内存或文件）
3. `EvalRunReport` 持久化：复用现有 `FileRuntimeStateStore` 或新增独立 json 文件写入
4. `RemoteRuntimeClient` 新增 `runEval(cases)` 和 `getEvalReport(runId)` 两个方法

**验收**：在 `tests/` 里增加一个 eval API 集成测试，验证通过 HTTP 能触发 eval、查询报告、结果与本地 `EvalRunner` 一致。

---

### 目标 D：构建验收基线（Eval Cases）

**问题**：`eval-core` 有运行框架，但没有任何内置基线用例，无法做版本间回归对比。

**要做的**：

在 `packages/eval-core/src/` 或 `tests/` 下新增 `baseline-cases.ts`，包含至少 5 个标准用例，对应 MVP 验收场景：

```
case_id: "mvp-clarification"     // 澄清问答
case_id: "mvp-multi-tool"        // 多工具串联
case_id: "mvp-approval"          // 高风险审批
case_id: "mvp-resume"            // 长任务恢复
case_id: "mvp-memory-recall"     // 经验复用
```

每个 case 设置 `expectations`，使 `EvalRunner` 可以自动判断 pass/fail。

**验收**：`EvalRunner.run(baselineCases)` 全部 pass，`pass_rate === 1`。

---

## 6. 优先级与顺序

```
1. 目标 A（门控路径）   — 修复现有实现，不需要新增文件，影响面小
2. 目标 B（验收测试）   — 依赖目标 A 中 approval 路径修复
3. 目标 D（基线用例）   — 依赖目标 B 的测试逻辑，可复用
4. 目标 C（Remote Eval） — 最后做，新增 HTTP 路由，依赖 D 的用例结构
```

完成以上 4 个目标后，MVP 所有条件满足，验收场景全覆盖，可以进入 npm 发布准备。
