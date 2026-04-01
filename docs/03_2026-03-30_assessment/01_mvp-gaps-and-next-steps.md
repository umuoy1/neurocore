# MVP 差距分析与下一步目标

> 基于 2026-03-30 代码状态，对照 `docs/02_2026-03-27_sdk/06_mvp-implementation-plan.md` 的最新校准。

## 1. 当前判断

当前代码已经达到 **功能性 MVP 完成 + 全部产品化补齐** 状态，P0/P1/P2/P3/M7 全部交付。

这次校准后，之前文档中的几项判断需要修正：

- MVP 验收场景 B1-B4 已经有端到端测试，不再是”无测试”。
- `Policy + Budget` 的基础闭环已经打通，cost budget 跟踪已实现。
- Remote Eval API 已经落地到 `runtime-server` 和 `eval-core`，eval 持久化已支持 InMemory + SQLite。
- baseline eval 测试已提炼成 `BASELINE_CASES` 共享模块，可从 `@neurocore/eval-core` 导入。

## 2. MVP 条件逐条对照

| # | 条件 | 状态 | 说明 |
|---|---|---|---|
| 1 | 开发者可以定义 Agent | ✅ 完成 | `defineAgent()`、工具/记忆/策略/预测器/技能注册可用 |
| 2 | Session 可以创建、恢复、完成 | ✅ 完成 | 含 resume、checkpoint、goal rebase、approval resume |
| 3 | Runtime 可以执行标准认知周期 | ✅ 完成 | `CycleEngine` 主链路打通 |
| 4 | Agent 可使用目标栈、工具、工作记忆和情景记忆 | ✅ 完成 | goal tree、tool gateway、working/episodic/semantic/procedural memory 均已接入；ProceduralMemoryProvider 支持 episode → skill 自动提炼 |
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
| Procedural Memory | ✅ | ProceduralMemoryProvider + InMemorySkillStore + SkillPromoter：episode → skill 自动提炼、skill-first 执行路径已实现 |
| Meta Controller | ✅ | policy block、warn->approval、uncertainty-based risk sort、configurable threshold、prediction error rate 消费已实现 |
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

**状态：已完成**

已完成：

- `DefaultPolicyProvider` 的 warn 现在会被 `MetaController` 转为审批流，而不是被忽略。
- `WorkspaceCoordinator.computeBudget` 已基于 cycle/tool/token/cost 预算做判断。
- `defineAgent().configurePolicy()` 已支持 tool allow/deny bundle。
- cost budget 跟踪已实现：`AgentProfile.cost_per_token` + `cost_budget`，`BudgetState.cost_budget_used` 逐 cycle 累加。
- reviewer policy 已实现：`AgentProfile.approval_policy.allowed_approvers` 支持审批者白名单，`ApprovalRequest.tenant_id` 审计追踪。

### 目标 B：补全验收场景测试

**状态：完成**

原先列出的 B1-B4 场景都已补齐到 `tests/mvp-scenarios.test.mjs`。

### 目标 C：Remote Eval API

**状态：完成**

已完成：

- `runtime-server` 提供 `POST /v1/evals/runs` 和 `GET /v1/evals/runs/:runId`
- `eval-core` 提供 `RemoteEvalClient.runEval()` / `getEvalReport()`
- 有独立 API 集成测试
- `EvalRunReport` 支持 `tenant_id` / `agent_id` 字段
- `InMemoryEvalStore` + `SqliteEvalStore` 提供持久化存储
- `GET /v1/evals/runs` 支持列表查询和过滤（tenant_id / agent_id / 分页）
- `DELETE /v1/evals/runs/:runId` 支持删除 eval run

### 目标 D：构建验收基线（Eval Cases）

**状态：已完成**

已完成：

- `tests/baseline-evals.test.mjs` 已经有 5 个 baseline eval 场景
- clarification / approval / tool chain 等基线可自动判定 pass/fail
- `BASELINE_CASES` 已从测试文件抽取到 `packages/eval-core/src/baseline-cases.ts` 共享模块
- 新增 `resume-after-waiting` 和 `memory-recall-influence` 两个标准 case
- 所有 case 可从 `@neurocore/eval-core` 导入

## 6. 当前最真实的剩余问题

这些问题已不再是“能否宣告 MVP”层面，而是 **MVP 后硬化 / 产品化缺口**：

### 6.1 执行正确性

- ~~`selected_action_id` 缺失或不匹配时仍会静默 fallback 到 `actions[0]`~~ **已完成（P0）**：无效 `selected_action_id` 直接报错中止 cycle
- ~~`GoalManager.isActionable()` 还没有真正使用 `dependencies`~~ **已完成（P0）**：goal dependency ordering 已生效
- ~~`SessionManager` 还没有真正的 session 级 CAS/lock，只在 hosted wrapper 层做了互斥~~ **已完成（P0）**：session-level CAS/lock 已实现

### 6.2 仲裁层能力

- `MetaController` 已支持 policy block、warn→approval、uncertainty-based ranking、configurable threshold、多维评分、冲突检测、prediction error rate 消费（高误差率降低 confidence 并触发 approval）
- ~~`WorkspaceCoordinator` 还是快照聚合器，不是广播-竞争-选择机制~~ **已完成**：broadcast-compete-select 三阶段机制、source weight、salience fusion、goal alignment、conflict detection、CompetitionLog

### 6.3 托管产品化

- ~~`runtime-server` 还没有 auth / permission checks~~ **已完成**：`ApiKeyAuthenticator` + auth 中间件 + tenant_id 校验
- ~~remote eval 报告还没有 durable persistence~~ **已完成**：`InMemoryEvalStore` + `SqliteEvalStore`
- ~~还没有真正的 session / approval list/filter / replay browsing control-plane API~~ **已完成**：`GET /v1/sessions` + `GET /v1/approvals` + `GET /v1/evals/runs` list/filter API

### 6.4 观测与发布

- ~~有 CI、有 tests、有 changesets，但还没有自动发布工作流~~ **已完成**：`.github/workflows/release.yml` changeset 自动发布
- ~~有 debug log 和 runtime events，但没有 metrics / structured log / OTel export~~ **已完成**：`Logger` 结构化 JSON 日志 + `GET /v1/metrics` + `GET /healthz` 增强
- ~~hosted runtime 测试需要 socket-capable 环境；LLM baseline 需要显式配置和外部连通性~~ **已完成**：`test:unit` / `test:hosted` / `test:baseline` 分层，CI baseline-llm gated lane

## 7. 下一步目标（MVP 之后）

以下目标已全部完成：

1. ~~**执行正确性硬化**~~ **已完成**
   - ~~unknown `selected_action_id` hard fail~~
   - ~~goal dependency ordering~~
   - ~~session-level CAS/lock~~

2. ~~**仲裁层升级**~~ **已完成**
   - ~~MetaController 冲突检测 / salience 融合 / richer risk reasoning~~
   - ~~Workspace 竞争广播机制~~

3. ~~**预测闭环**~~ **已完成**
   - ~~PredictionStore + PredictionErrorComputer + RuleBasedPredictor~~
   - ~~MetaController 消费 predictionErrorRate~~
   - ~~prediction-observation-error-correction 完整闭环~~
   - 验证：`tests/prediction-error.test.mjs`（8 个测试）

4. ~~**Hosted Runtime 产品化**~~ **已完成**
   - ~~auth / tenant permission checks~~
   - ~~durable eval persistence~~
   - ~~session / approval / replay admin APIs~~
   - ~~reviewer policy + allowed_approvers~~
   - ~~replay 浏览 API~~
   - ~~eval comparison API (FR-27)~~

5. ~~**观测与发布**~~ **已完成**
   - ~~metrics / structured logs / health saturation~~
   - ~~automated publish workflow~~
   - ~~CI 测试分层 + LLM baseline gated lane~~

6. ~~**运营能力增强**~~ **已完成**
   - ~~webhook 重试 + 投递日志~~
   - ~~remote client 超时 + 重试~~
   - ~~cost budget 跟踪~~
   - ~~baseline eval cases 共享模块~~

## 8. 结论

这次校准后的结论是：

- **MVP 已功能完成，所有 post-MVP 目标已全部交付**
- P0 执行正确性硬化、P1 预测闭环 + 技能系统、P2 产品化补齐、P3 运营能力增强、M7 CI/CD 自动化、M8 世界模型与设备接入、M9 多 Agent 分布式调度均已完成
- 255 个测试全部通过（M9 新增 86 个：registry/heartbeat/bus/delegation/coordination/goal/shared-state/lifecycle + runtime-core 集成），覆盖全部新增功能
- 当前阶段边界外的工作保持在 `02_gap-analysis-and-roadmap.md` §4 中
