# NeuroCore 里程碑交付记录

> 当前进度跟踪已迁移至 [`docs/README.md`](../README.md)，本文档为历史交付记录。

## 完成度

| 参照基准 | 完成度 |
|---|---|
| MVP 定义（`06_mvp-implementation-plan.md`） | ~100% |
| 第一阶段 FR 清单（`01_requirements.md`） | ~98% |
| 六模块完整目标（`04_neurocore-agent-architecture-full.md`） | ~90%~95% |

## 已完成里程碑

| Milestone | 名称 | 核心交付物 |
|---|---|---|
| M5.1 | 仲裁层升级 | `WorkspaceCoordinator` broadcast-compete-select + `MetaController` 多维评分/冲突检测 |
| M5.2 | 预测闭环 | `PredictionStore` + `PredictionErrorComputer` + `RuleBasedPredictor` + MetaController error rate 消费 |
| M5.3 | 技能系统 | `SkillExecutor` + `ProceduralMemoryProvider` + episode → skill 自动提炼 + skill-first 路径 |
| M6 | Hosted Runtime 产品化 | API key 认证 + tenant 隔离 + durable eval + admin APIs + reviewer policy + 结构化日志/metrics |
| M7 | 测试、CI 与发布 | GitHub Actions CI + test 分层 + baseline-llm gated lane + changesets 自动发布 |
| M8 | 世界模型与设备接入 | `device-core`（Sensor/Actuator SPI + Registry + Pipeline）+ `world-model`（WorldStateGraph + ForwardSimulator）+ CycleEngine Perceive 阶段 |
| M9 | 多 Agent 分布式调度 | `multi-agent`（Registry + Bus + Delegator + Auction + Coordination + SharedState + Lifecycle）+ CycleEngine delegate 分支 |

## 已实现核心能力

- **协议与分层**：`protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core`
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory / Trace / Checkpoint
- **Goal Tree**：root goal、分解、父子状态派生、显式输入 rebase
- **Tool Gateway**：注册、schema 校验、超时、重试、失败观测、执行指标
- **记忆四层**：working + episodic + semantic + procedural，tenant-scoped cross-session recall
- **预算与压缩**：token/tool/cycle/cost budget assessment、token accounting、graded context compression
- **托管 Runtime**：HTTP API、async/stream、SSE、webhook（重试 + 投递日志）、文件/SQLite 持久化、远程 client（超时 + 重试）
- **Trace / Replay / Eval**：本地 eval runner、remote eval API、session replay、eval 持久化、baseline eval cases 共享模块

## 关键风险（历史记录）

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级破坏现有闭环 | 新模块/新策略路径落地 + test harness 回归 |
| session-level lock/CAS 影响 resume/approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 兼容性 | 保留内存 fallback + 增量接入 |
| auth/tenant permission 影响现有 API | 可选 middleware/headers + 分阶段收紧 |
