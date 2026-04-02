# NeuroCore 里程碑交付记录（历史修订版）

> 当前进度跟踪已迁移至 [`docs/README.md`](../README.md)，本文档保留为阶段性评估记录。
>
> 2026-04-02 校准说明：
> - M8 世界模型 / 设备接入与 M9 多 Agent 调度代码均已进入主干。
> - M11 运营控制台已具备 SPA 脚手架、REST 端点和多个后端 store，但仍处于联调收口阶段。
> - 因此，下文中的“已完成”表示“该阶段的主体交付已进入代码库”，不表示所有 hosted / Console 端到端验证都已结束。

## 完成度

| 参照基准 | 完成度 |
|---|---|
| MVP 定义（`06_mvp-implementation-plan.md`） | ~100% |
| 第一阶段 FR 清单（`01_requirements.md`） | ~98% |
| 六模块完整目标（`04_neurocore-agent-architecture-full.md`） | ~85%~90% |

## 已完成里程碑

| Milestone | 名称 | 核心交付物 |
|---|---|---|
| M5.1 | 仲裁层升级 | `WorkspaceCoordinator` broadcast-compete-select + `MetaController` 多维评分/冲突检测 |
| M5.2 | 预测闭环 | `PredictionStore` + `PredictionErrorComputer` + `RuleBasedPredictor` + MetaController error rate 消费 |
| M5.3 | 技能系统 | `SkillExecutor` + `ProceduralMemoryProvider` + episode → skill 自动提炼 + skill-first 路径 |
| M6 | Hosted Runtime 产品化（核心） | HTTP API + async/stream + SSE + webhook + file/SQLite 持久化 + remote client + auth/config/audit/metrics 基础设施 |
| M7 | 测试、CI 与发布（核心） | GitHub Actions CI + test 分层 + baseline-llm gated lane + changesets/release workflow |
| M8 | 世界模型与设备接入 | `device-core`（Sensor/Actuator SPI + Registry + Pipeline）+ `world-model`（WorldStateGraph + ForwardSimulator）+ CycleEngine Perceive 阶段 |
| M9 | 多 Agent 分布式调度 | `multi-agent`（Registry + Bus + Delegator + Auction + Coordination + SharedState + Lifecycle）+ CycleEngine delegate 分支 |

## 当前进行中里程碑

| Milestone | 名称 | 当前状态 |
|---|---|---|
| M11 | 运营控制台（Operations Console） | `packages/console` 已有 14 个页面、状态管理和 API 客户端；`runtime-server` 已有 metrics/audit/config/ws store 与多组 REST 端点；当前主要工作为 API/WS 契约对齐、缺失端点补齐和联调验证 |

## 已实现核心能力

- **协议与分层**：`protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core`
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory / Trace / Checkpoint
- **Goal Tree**：root goal、分解、父子状态派生、显式输入 rebase
- **Tool Gateway**：注册、schema 校验、超时、重试、失败观测、执行指标
- **记忆四层**：working + episodic + semantic + procedural，tenant-scoped cross-session recall
- **预算与压缩**：token/tool/cycle/cost budget assessment、token accounting、graded context compression
- **托管 Runtime**：HTTP API、async/stream、SSE、webhook（重试 + 投递日志）、文件/SQLite 持久化、远程 client（超时 + 重试）
- **Trace / Replay / Eval**：本地 eval runner、remote eval API、session replay、eval 持久化、baseline eval cases 共享模块
- **世界模型与设备**：Perception Pipeline、Device Registry、WorldStateGraph、ForwardSimulator、SimulationBasedPredictor
- **多 Agent**：Agent Registry、Inter-Agent Bus、Task Delegator、Coordination Strategies、Shared State、Lifecycle Manager
- **运营控制台骨架**：Dashboard / Session / Trace / Goal / Memory / Workspace / Eval / Approval / Multi-Agent / World Model / Device / Config 页面及对应 Zustand store

## 当前收尾项（截至 2026-04-02）

- Console API 基础层未完全统一，存在 `/v1/v1/*` 路径重复和若干返回结构不一致问题。
- `WsServer` 已实现但仍需完成 `runtime-server` 启动接线、鉴权协商与前端订阅联调。
- `world-state`、`memory/semantic`、`skills`、`delegations`、`devices` 等端点仍需补齐，才能让 Console 高级页面脱离占位视图。
- Hosted / socket-bound 测试仍需在允许本地监听端口的环境中做一次完整验证。

## 关键风险（历史记录）

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级破坏现有闭环 | 新模块/新策略路径落地 + test harness 回归 |
| session-level lock/CAS 影响 resume/approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 兼容性 | 保留内存 fallback + 增量接入 |
| Console 联调暴露接口契约漂移 | 先统一 API 基础层与类型，再做页面逐页联调 |
