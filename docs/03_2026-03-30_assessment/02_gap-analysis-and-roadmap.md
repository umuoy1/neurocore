# NeuroCore 差距分析与后续路线图

> 基于 2026-03-30 代码状态，对照 docs/ 架构目标的校准版评估。

## 1. 当前完成度评估

### 1.1 总体结论

现有代码已经处于 **功能性 MVP 完成 + 早期产品化阶段**：

- 本地 runtime 主闭环已经稳定可跑
- Hosted runtime 的 async / stream / webhook / eval API 已有实现
- 记忆、预算、审批、trace / replay / eval 的基础能力已成型
- 当前主要差距不再是”能否运行”，而是 **细粒度风险模型、自动发布、以及运营能力增强**

相对几个参照系的当前估计：

| 参照基准 | 完成度 |
|---|---|
| `docs/02_2026-03-27_sdk/06_mvp-implementation-plan.md` MVP 定义 | ~100% |
| `docs/02_2026-03-27_sdk/01_requirements.md` 第一阶段 FR 清单 | ~98% |
| `docs/01_2026-03-27_paradigm/04_neurocore-agent-architecture-full.md` 六模块完整目标 | ~85%~90% |

### 1.2 六模块完成度

| 模块 | 对应神经科学映射 | 完成度 | 状态说明 |
|---|---|---|---|
| Cortex / Reasoner | 大脑皮层 | 70% | LLM reasoner、plan/respond、OpenAI-compatible adapter 已有；多模态、结构化流式输出、高级推理策略未做 |
| Hippocampal / Memory | 海马体 | 80% | working / episodic / semantic / procedural 已实现，支持 tenant-scoped cross-session recall 和 retrieval_top_k；ProceduralMemoryProvider 支持 episode → skill 自动提炼；TTL、negative learning 未做 |
| Cerebellar / World Model | 小脑 | 90% | PredictionStore、PredictionErrorComputer、RuleBasedPredictor 已实现；prediction-observation-error-correction 闭环已打通；MetaController 消费误差率降低 confidence 并触发 approval；**M8 新增**：device-core（Sensor/Actuator SPI、DeviceRegistry、PerceptionPipeline）+ world-model（WorldStateGraph、ForwardSimulator、SimulationBasedPredictor）已实现并集成到 CycleEngine/AgentRuntime；Active Inference、Device Coordination 未做 |
| Amygdala / Motivation-Risk | 杏仁核 | 40% | 基础 policy / warn-block / approval / budget gate 已有；reviewer policy + allowed_approvers + tenant-aware approval audit 已实现；cost budget 跟踪已实现；更细粒度 risk model 未做 |
| Basal Ganglia / Skill | 基底神经节 | 80% | skill match proposal 已接入 cycle；SkillStore / InMemorySkillStore、SkillExecutor、SkillPromoter、ProceduralMemoryProvider 已实现；skill 匹配-执行-积累-提炼循环已闭合；episode → skill 自动提炼已实现；skill-first 执行路径已实现；skill.matched / skill.executed / skill.promoted 事件已注册 |
| Prefrontal / Meta | 前额叶 | 85% | policy block、warn->approval、uncertainty-based ranking、configurable threshold、multi-dimensional scoring (salience/confidence/risk)、conflict detection、risk_summary、prediction error rate 消费已有；仍缺 richer reasoning 和 explanation generation |
| Global Workspace | 全局工作空间 | 80% | broadcast-compete-select 三阶段竞争机制已实现：source weight、salience fusion、goal alignment、conflict detection、CompetitionLog |

### 1.3 已实现部分（稳固）

- **协议与分层**：`protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core` 均有实装
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory / Trace / Checkpoint 全链路打通
- **Goal Tree**：root goal、分解、父子状态派生、显式输入 rebase 已实现
- **Tool Gateway**：注册、schema 校验、超时、重试、失败观测、执行指标已实现
- **记忆四层**：working + episodic + semantic + procedural 已实现，支持 tenant-scoped cross-session recall；ProceduralMemoryProvider 支持 episode → skill 自动提炼
- **预算与压缩**：token/tool/cycle/cost budget assessment、token accounting、cost budget 跟踪、graded context compression 已实现
- **托管 Runtime**：HTTP API、async/stream、SSE event stream、webhook（含重试 + 投递日志）、文件/SQLite 持久化、远程 client（含超时 + 重试）、API key 认证、tenant 隔离、reviewer policy + allowed_approvers、结构化日志、metrics/health 端点已实现
- **Trace / Replay / Eval**：本地 eval runner、remote eval API、session replay、replay 浏览 API、eval 持久化（InMemory + SQLite）、eval 列表/过滤/删除/比较 API、baseline eval cases 共享模块已实现
- **预测闭环**：PredictionStore、PredictionErrorComputer、RuleBasedPredictor 已实现；prediction-observation-error-correction 闭环已打通；trace 包含 prediction_error_refs 和 prediction_errors；Episode 基于误差填充 valence/lessons
- **设备接入与世界模型（M8）**：`device-core` 包（Sensor/Actuator SPI、MockCameraSensor、MockSpeakerActuator、InMemoryDeviceRegistry、DefaultPerceptionPipeline）+ `world-model` 包（InMemoryWorldStateGraph、RuleBasedSimulator、SimulationBasedPredictor）已实现；CycleEngine 新增 Perceive 阶段（感知-融合-衰减-裁剪）；AgentRuntime 可选注入设备组件；7 种新事件类型已注册
- **测试与 CI**：本地单元/集成测试（169 个）、GitHub Actions CI（含 test:unit 分层 + baseline-llm gated lane）、changesets 配置 + 自动发布 workflow 已存在；prediction-error 测试覆盖 store/computer/E2E/MetaController/RuleBasedPredictor；M8 新增 38 个测试覆盖 sensor/actuator/registry/pipeline/graph/simulation/integration

### 1.4 主要差距

| 差距 | 影响 | 优先级 |
|---|---|---|
| Global Workspace 仍是快照汇总而非竞争广播 | 多模块并行认知能力缺失 | ~~P0~~ 已完成 |
| MetaController 仍主要是风险排序后取第一个候选 | 冲突检测、仲裁、解释性不足 | ~~P0~~ 已完成 |
| `selected_action_id` 无效时仍静默 fallback | 执行正确性风险 | ~~P0~~ 已完成 |
| `Goal.dependencies` 未参与 actionability 判断 | goal ordering 语义未闭环 | ~~P0~~ 已完成 |
| `SessionManager` 无真正 session 级 CAS/lock | 本地/内核层并发安全不足 | ~~P0~~ 已完成 |
| Predictor 无完整误差回写闭环 | 世界模型能力停留在 SPI 级别 | ~~P1~~ 已完成 |
| Skill 只有 match，无 execute / procedural memory | 技能积累与复用能力不足 | ~~P1~~ 已完成 |
| Hosted runtime 无 auth，eval 报告无 durable persistence | 企业级产品化不足 | ~~P1~~ 已完成 |
| 观测与发布自动化不完整 | 运维、调试、持续交付能力不足 | ~~P2~~ 已完成 |

## 2. 后续里程碑规划

### Milestone 5.1：仲裁层升级（Meta + Workspace）

**目标**：把”风险排序 + 选第一个”升级为真正的仲裁和竞争广播机制。

**当前已有**：

- `WorkspaceSnapshot` 已可承载 risk / confidence / budget / policy 摘要
- `MetaController` 已支持 policy block、warn->approval、configurable threshold

**剩余交付物**：

- ~~`WorkspaceCoordinator`：实现 broadcast -> compete -> select 三阶段~~ **已完成**
- ~~`MetaController`：引入 salience / confidence / risk 多维评分、冲突检测、升级决策~~ **已完成**
- ~~对 invalid `selected_action_id` 直接报错，而不是 fallback~~ **已完成**
- ~~让 `Goal.dependencies` 真正影响可执行性判断~~ **已完成**

**验收标准**：

- ~~两个模块提出冲突 action 时，runtime 能给出稳定且可解释的选择~~ **已完成** — broadcast-compete-select 机制已实现
- ~~无效 `selected_action_id` 会中止当前 cycle，而不是静默执行其他动作~~ **已完成**
- ~~带 dependencies 的 goal 能按依赖顺序推进~~ **已完成**

### Milestone 5.2：预测闭环（Cerebellar / World Model）

**目标**：把 predictor 从 SPI 接口升级为完整预测-误差-修正闭环。

**状态：已完成**

**已完成交付物**：

- `PredictionStore` 接口 + `InMemoryPredictionStore`：记录每次预测与实际观测的对比
- `PredictionErrorComputer`：纯函数对比预测与观测，生成 outcome/duration/side_effect mismatch 误差
- `PredictionError` 回写：在 observation 阶段写入误差，emit `prediction_error.recorded` 事件，通知 predictors
- 策略修正：MetaController 消费 `predictionErrorRate`，高误差率时降低 confidence（乘以 `1 - errorRate * 0.3`）并触发 approval
- `RuleBasedPredictor`：基于 action_type + side_effect_level + 历史误差率的规则型预测实现
- `CycleTrace.prediction_error_refs` + `CycleTraceRecord.prediction_errors`：trace 中可查询误差
- Episode 增强：基于 prediction errors 填充 `valence` 和 `lessons`
- 8 个新测试覆盖 store CRUD、error computation、E2E 闭环、MetaController 响应

**验收标准**：

- ~~每个 cycle 的预测与结果可查询、可回放~~ **已完成** — trace 包含 prediction_error_refs 和 prediction_errors
- ~~连续误差超阈值时，MetaController 能感知并改变策略~~ **已完成** — errorRate >= 0.5 触发 approval

### Milestone 5.3：技能系统（Basal Ganglia / Skill）

**目标**：把 skill 从”匹配提示”升级为可执行的 procedural memory。

**交付物**：

- ~~`SkillExecutor`：skill 能执行并返回 observation~~ **已完成**
- ~~`ProceduralMemory`：存储、检索、版本化技能~~ **已完成**
- ~~技能写入流程：episode 达到阈值后可提炼为 skill~~ **已完成**
- ~~skill-first 路径：命中技能时优先复用，再 fallback 到 reasoner~~ **已完成**

**验收标准**：

- ~~相似任务第二次执行时，能优先命中 skill 路径~~ **已通过**
- ~~技能执行可被 trace 记录并在 replay 中还原~~ **已通过**

### Milestone 6：Hosted Runtime Productization

#### 6.1 认证与租户治理

- ~~`runtime-server` 接入 API key 或 JWT~~ **已完成**：`ApiKeyAuthenticator` 支持 Bearer / X-API-Key，auth 中间件 gating 非 healthz 路由，tenant_id 校验
- ~~session / approval / trace 路径增加 request-time permission checks~~ **已完成**：session 创建强制 tenant_id 匹配 AuthContext
- ~~reviewer policy 与 approval audit identity 细化~~ **已完成**：`AgentProfile.approval_policy.allowed_approvers` 支持审批者白名单，`ApprovalRequest.tenant_id` 审计追踪，审批时 tenant 匹配校验

#### 6.2 Eval 持久化与控制面

- ~~eval 报告 durable persistence（文件 / SQLite）~~ **已完成**：`InMemoryEvalStore` + `SqliteEvalStore`，`EvalRunReport` 新增 `tenant_id` / `agent_id`
- ~~eval run 列表、查询、比较 API~~ **已完成**：`GET /v1/evals/runs` (list + filter) + `DELETE /v1/evals/runs/:runId`
- ~~replay 浏览 API~~ **已完成**：`GET /v1/sessions/:id/replay` 返回 `SessionReplay`（含 cycle_count + traces），`GET /v1/sessions/:id/replay/:cycleId` 返回单 cycle record
- ~~session / approval list/filter API~~ **已完成**：`GET /v1/sessions` + `GET /v1/approvals` 支持 tenant/state/status 过滤

#### 6.3 观测与健康

- ~~结构化日志（JSON）~~ **已完成**：`Logger` 类，JSON 行输出，请求级日志含 method/path/status/duration_ms/tenant_id
- ~~metrics 导出接口~~ **已完成**：`GET /v1/metrics` 返回 session/cycle/eval/SSE 计数
- ~~runtime health / saturation / backlog 指标~~ **已完成**：`GET /healthz` 增强返回 active_sessions、uptime_seconds、version

### Milestone 7：测试、CI 与发布自动化

**状态：已完成**

**已有**：

- GitHub Actions CI：Node 22/24 跑 typecheck + test:unit（排除 LLM baseline）
- unit/integration tests（132 个测试）
- changesets 配置和 release scripts

**已完成交付物**：

- ~~自动 publish workflow~~ **已完成**：`.github/workflows/release.yml` 使用 `changesets/action@v1`，push to main 自动创建 version PR 或发布
- ~~对 hosted runtime 和 socket-bound 测试做环境分层~~ **已完成**：`test:unit`（排除 LLM）、`test:hosted`（hosted 相关）、`test:baseline`（LLM baseline）
- ~~将 optional LLM baseline 从”本地可选”提升为可控的 gated CI lane~~ **已完成**：`baseline-llm` job，条件 `workflow_dispatch` 或 `[run-baseline]` commit message 触发

### Milestone 8：世界模型与设备接入（M8）

**目标**：将 Cerebellar 模块从”预测引擎”升级为”感知-预测-执行”完整世界模型，新增设备抽象层。

**状态：已完成**

**已完成交付物**：

- `packages/device-core/`：Sensor/Actuator SPI 接口 + MockCameraSensor/MockSpeakerActuator + InMemoryDeviceRegistry（含健康检测与热插拔）+ DefaultPerceptionPipeline（多模态并行处理、超时保护、错误隔离）
- `packages/world-model/`：WorldStateGraph 接口 + InMemoryWorldStateGraph（entity/relation CRUD、query 过滤、applyPercepts、confidence decay、TTL pruning、toDigest）+ ForwardSimulator SPI + RuleBasedSimulator + SimulationBasedPredictor
- `packages/protocol/src/events.ts`：7 种新事件类型（sensor.reading、actuator.command/result、world_state.updated、simulation.completed、device.registered/error）
- `packages/protocol/src/types.ts`：AgentProfile 新增 device_config / world_model_config 可选字段
- CycleEngine 集成：Perceive 阶段（query sensors → read → pipeline → decay → prune → applyPercepts → toDigest）
- AgentRuntime 集成：4 个可选注入字段，SimulationBasedPredictor 自动创建
- 38 个新测试全部通过

**验收标准**：

- ~~注入设备组件后 perceive 阶段填充 world_state_digest~~ **已完成**
- ~~forwardSimulator 注入后 predictions 包含 simulation-based 结果~~ **已完成**
- ~~不注入时行为不变（向后兼容）~~ **已完成**

**推迟项（P2）**：Active Inference（FR-42）、Device Coordination（FR-43）——仅定义接口，未实现

## 3. 优先级排序

```text
P0（立即推进）：
  - ~~Meta / Workspace 仲裁层升级~~ 已完成
  - ~~selected_action_id hard fail~~ 已完成
  - ~~goal dependency ordering~~ 已完成
  - ~~SessionManager session-level CAS / lock~~ 已完成

P1（P0 完成后）：
  - ~~Predictor 误差闭环~~ 已完成
  - ~~Skill execute / procedural memory~~ 已完成
  - ~~Hosted runtime auth~~ 已完成
  - ~~Durable eval persistence~~ 已完成

P2（产品化补齐）：
  - ~~Control-plane query/list/filter APIs~~ 已完成
  - ~~Structured logs / metrics / health saturation~~ 已完成
  - ~~Automated publish workflow~~ 已完成
  - ~~Replay 浏览 API~~ 已完成
  - ~~Reviewer policy + approval audit identity~~ 已完成
  - ~~Cost budget 跟踪~~ 已完成
  - ~~Baseline eval cases 共享模块~~ 已完成
  - ~~CI 测试环境分层~~ 已完成
  - ~~LLM baseline gated CI lane~~ 已完成

P3（运营能力增强）：
  - ~~Replay/eval comparison workflows~~ 已完成
  - ~~Webhook reliability guarantees~~ 已完成
  - ~~Broader remote client hardening~~ 已完成
```

## 4. 不做的事（当前阶段边界）

- 多 Agent 分布式调度
- ~~高保真世界状态图（图数据库）~~ 基础 InMemoryWorldStateGraph 已实现（M8），图数据库后端推迟
- 技能自动提炼的强化学习
- 完整运营控制台 UI
- 通用 AGI 式自主体能力
- Active Inference 实现（FR-42，仅接口定义）
- Device Coordination 实现（FR-43，仅接口定义）

## 5. 关键风险

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级容易破坏现有稳定闭环 | 先在新模块或新策略路径里落地，并用现有 test harness 回归 |
| session-level lock/CAS 改造会影响 resume / approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 引入兼容性问题 | 先保留内存实现作 fallback，再增量接入 file/SQLite store |
| auth / tenant permission 改造影响现有 API 使用方式 | 优先增加可选 middleware / headers 方案，分阶段收紧 |

## 6. 结论

这次校准后的判断是：

- NeuroCore 已完成 **MVP + 全部产品化补齐 + 运营能力增强 + M8 世界模型与设备接入**，P0/P1/P2/P3/M7/M8 全部交付
- 六模块完成度显著提升：Cerebellar/World Model 从 75% 升至 90%（device-core + world-model 两个新包），整体架构完成度 ~85%~90%
- 自动发布 workflow、CI 测试分层、gated LLM baseline lane 已就绪
- 169 个测试全部通过（M8 新增 38 个），覆盖 sensor/actuator/registry/pipeline/graph/simulation/integration
- 当前阶段边界外的工作（多 Agent 调度、图数据库后端、RL 自动提炼、控制台 UI、Active Inference、Device Coordination）保持不做
