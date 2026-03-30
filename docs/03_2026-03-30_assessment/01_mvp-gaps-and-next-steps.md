# MVP 差距分析与下一步目标

> 基于 2026-03-30 代码状态，对照 `docs/02_2026-03-27_sdk/06_mvp-implementation-plan.md` 的最新校准。

## 1. 当前判断

当前代码已经达到 **功能性 MVP 完成** 状态，且已进入“运行时加固 + 托管产品化补齐”阶段。

这次校准后，之前文档中的几项判断需要修正：

- MVP 验收场景 B1-B4 已经有端到端测试，不再是“无测试”。
- `Policy + Budget` 的基础闭环已经打通，不再是“候选 action 数量 < 20”的 stub 时代。
- Remote Eval API 已经落地到 `runtime-server` 和 `eval-core`，但报告持久化仍然只是进程内存级别。
- baseline eval 测试已经存在，但还没有提炼成可复用、可发布的标准 case 库。

## 2. MVP 条件逐条对照

| # | 条件 | 状态 | 说明 |
|---|---|---|---|
| 1 | 开发者可以定义 Agent | ✅ 完成 | `defineAgent()`、工具/记忆/策略/预测器/技能注册可用 |
| 2 | Session 可以创建、恢复、完成 | ✅ 完成 | 含 resume、checkpoint、goal rebase、approval resume |
| 3 | Runtime 可以执行标准认知周期 | ✅ 完成 | `CycleEngine` 主链路打通 |
| 4 | Agent 可使用目标栈、工具、工作记忆和情景记忆 | ✅ 完成 | goal tree、tool gateway、working/episodic/semantic memory 均已接入 |
| 5 | 高风险动作有基础门控 | ✅ 完成 | warn/block policy、生效中的 approval flow、token/tool/cycle budget 判断均已存在 |
| 6 | 运行过程可追踪、可回放、可评估 | ✅ 完成 | trace / replay / eval runner / remote eval API 均已实现 |

## 3. MVP 必须交付清单对照

| 交付物 | 状态 | 说明 |
|---|---|---|
| Protocol Schema | ✅ | 基础协议、命令、事件、核心类型均存在 |
| Agent Builder | ✅ | `defineAgent()` + runtime wiring 可用 |
| Session Runtime | ✅ | create / run / resume / checkpoint / approval / replay 打通 |
| Goal Stack | ✅ | root goal、分解、父子状态派生、显式输入 rebase 已实现 |
| Workspace Snapshot | ✅ | 已包含 risk / confidence / budget / policy 摘要；竞争广播机制已实现（broadcast-compete-select） |
| Tool Gateway | ✅ | schema 校验、超时、重试、失败观测、执行指标已实现 |
| Working Memory | ✅ | session-scoped working memory 已实现 |
| Episodic Memory | ✅ | session + cross-session episodic recall 已实现 |
| Semantic Memory | ✅ | repeated successful episodes 的 tenant-scoped consolidation 已实现 |
| Meta Controller | ✅ | policy block、warn->approval、uncertainty-based risk sort、configurable threshold 已实现 |
| Trace Store | ✅ | cycle trace / records / events 可查询 |
| Replay Runner | ✅ | session replay 已实现 |
| Eval Harness | ✅ | local eval runner + remote eval API 均可用 |

## 4. MVP 验收场景覆盖情况

| 场景 | 状态 | 证据 |
|---|---|---|
| 复杂问答 + 澄清（ask_user 后 resume） | ✅ | `tests/mvp-scenarios.test.mjs` B1 |
| 多工具串联任务 | ✅ | `tests/mvp-scenarios.test.mjs` B2 |
| 高风险工具审批 | ✅ | `tests/mvp-scenarios.test.mjs` B3 |
| 长任务恢复 | ✅ | `tests/runtime.test.mjs` 中显式 input rebase / resume 覆盖 |
| 经验复用（历史 episode 影响决策） | ✅ | `tests/mvp-scenarios.test.mjs` B4 |

## 5. 对旧版“目标 A-D”的校准

### 目标 A：补全门控路径（Policy + Budget）

**状态：大体完成**

已完成：

- `DefaultPolicyProvider` 的 warn 现在会被 `MetaController` 转为审批流，而不是被忽略。
- `WorkspaceCoordinator.computeBudget` 已基于 cycle/tool/token 预算做判断。
- `defineAgent().configurePolicy()` 已支持 tool allow/deny bundle。

仍未完成：

- 还没有 cost budget 跟踪。
- 还没有按 tenant / risk level 的更细粒度审批策略。
- `MetaDecision` 里还没有有意义的 `risk_summary`。

### 目标 B：补全验收场景测试

**状态：完成**

原先列出的 B1-B4 场景都已补齐到 `tests/mvp-scenarios.test.mjs`。

### 目标 C：Remote Eval API

**状态：功能完成，持久化未完成**

已完成：

- `runtime-server` 提供 `POST /v1/evals/runs` 和 `GET /v1/evals/runs/:runId`
- `eval-core` 提供 `RemoteEvalClient.runEval()` / `getEvalReport()`
- 有独立 API 集成测试

仍未完成：

- `EvalRunReport` 仍只保存在 server 进程内存里，重启后丢失
- 还没有 eval run 列表、过滤和比较能力

### 目标 D：构建验收基线（Eval Cases）

**状态：部分完成**

已完成：

- `tests/baseline-evals.test.mjs` 已经有 5 个 baseline eval 场景
- clarification / approval / tool chain 等基线可自动判定 pass/fail

仍未完成：

- baseline cases 仍散落在测试文件中，没有抽成共享 `baseline-cases.ts`
- 当前 baseline library 还没有覆盖“resume”和“memory recall”两个可复用标准 case

## 6. 当前最真实的剩余问题

这些问题已不再是“能否宣告 MVP”层面，而是 **MVP 后硬化 / 产品化缺口**：

### 6.1 执行正确性

- `selected_action_id` 缺失或不匹配时仍会静默 fallback 到 `actions[0]`
- `GoalManager.isActionable()` 还没有真正使用 `dependencies`
- `SessionManager` 还没有真正的 session 级 CAS/lock，只在 hosted wrapper 层做了互斥

### 6.2 仲裁层能力

- `MetaController` 已支持 policy block、warn→approval、uncertainty-based ranking、configurable threshold、多维评分、冲突检测
- ~~`WorkspaceCoordinator` 还是快照聚合器，不是广播-竞争-选择机制~~ **已完成**：broadcast-compete-select 三阶段机制、source weight、salience fusion、goal alignment、conflict detection、CompetitionLog

### 6.3 托管产品化

- `runtime-server` 还没有 auth / permission checks
- remote eval 报告还没有 durable persistence
- 还没有真正的 session / approval list/filter / replay browsing control-plane API

### 6.4 观测与发布

- 有 CI、有 tests、有 changesets，但还没有自动发布工作流
- 有 debug log 和 runtime events，但没有 metrics / structured log / OTel export
- hosted runtime 测试需要 socket-capable 环境；LLM baseline 需要显式配置和外部连通性

## 7. 下一步目标（MVP 之后）

建议按下面顺序推进：

1. **执行正确性硬化**
   - unknown `selected_action_id` hard fail
   - goal dependency ordering
   - session-level CAS/lock

2. ~~**仲裁层升级**~~ **已完成**
   - ~~MetaController 冲突检测 / salience 融合 / richer risk reasoning~~
   - ~~Workspace 竞争广播机制~~

3. **Hosted Runtime 产品化**
   - auth / tenant permission checks
   - durable eval persistence
   - session / approval / replay admin APIs

4. **观测与发布**
   - metrics / structured logs / health saturation
   - automated publish workflow

## 8. 结论

这次校准后的结论是：

- **MVP 已经功能完成**
- **旧文档明显低估了当前代码进度**
- **真正的缺口已经从 MVP 收尾，转移到 runtime hardening、仲裁层升级、托管产品化和观测发布**
