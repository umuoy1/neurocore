# NeuroCore 里程碑交付记录（历史修订版）

> 当前进度跟踪已迁移至 [`docs/README.md`](../README.md)，本文档保留为阶段性评估记录。
>
> 2026-04-02 校准说明：
> - M8 世界模型 / 设备接入已形成主链路闭环。
> - M9 多 Agent 调度原语已进入主干，但 delegate 续跑闭环仍待补。
> - M11 运营控制台已具备方案、REST 端点与 Console 预实现，但当前不作为主优先级推进。
> - 当前执行顺序调整为：个人助理产品线 + Console 相关准备 → 记忆系统演进 → 未来再恢复 M11 完整实施。
> - 因此，下文中的“已完成”表示“该阶段的主体交付已进入代码库”，不表示所有 hosted / Console 端到端验证都已结束。
> - 更精确的代码反推结论见 [`03_code-audit-checklist.md`](./03_code-audit-checklist.md)。

## 完成度

| 参照基准 | 完成度 |
|---|---|
| MVP 定义（`06_mvp-implementation-plan.md`） | ~100% |
| 第一阶段 FR 清单（`01_requirements.md`） | ~98% |
| 六模块完整目标（`04_neurocore-agent-architecture-full.md`） | ~85%~90% |

## 已完成或主体已实现的里程碑

| Milestone | 名称 | 状态 | 核心交付物 |
|---|---|---|---|
| M5.1 | 仲裁层升级 | ✅ | `WorkspaceCoordinator` broadcast-compete-select + `MetaController` 多维评分/冲突检测 |
| M5.2 | 预测闭环 | ✅ | `PredictionStore` + `PredictionErrorComputer` + `RuleBasedPredictor` + MetaController error rate 消费 |
| M5.3 | 技能系统 | ✅ | `SkillExecutor` + `ProceduralMemoryProvider` + episode → skill 自动提炼 + skill-first 路径 |
| M6 | Hosted Runtime 产品化（核心） | ✅ | HTTP API + async/stream + SSE + webhook + file/SQLite 持久化 + remote client + auth/config/audit/metrics 基础设施 |
| M7 | 测试、CI 与发布（核心） | ✅ | GitHub Actions CI + test 分层 + baseline-llm gated lane + changesets/release workflow |
| M8 | 世界模型与设备接入 | ✅ | `device-core`（Sensor/Actuator SPI + Registry + Pipeline）+ `world-model`（WorldStateGraph + ForwardSimulator）+ CycleEngine Perceive 阶段 |
| M9 | 多 Agent 分布式调度 | ◐ | `multi-agent`（Registry + Bus + Delegator + Auction + Coordination + SharedState + Lifecycle）+ CycleEngine delegate 分支 |

## 当前执行优先级

| 阶段 | 工作流 | 当前状态 |
|---|---|---|
| 当前 | 个人助理 + Console 准备 | 以 `docs/05_2026-04-01_personal-assistant/` 为主线推进产品化；Console 侧仅保留接口契约整理、后端支持梳理与预实现维护 |
| 下一阶段 | 记忆系统演进 | 进入 `docs/05_2026-04-01_memory-evolution/` 的需求收敛、迁移计划与验证设计 |
| 更后阶段 | M11 运营控制台 | 待个人助理和记忆系统演进阶段收口后，再恢复 M11 的完整联调、E2E 与正式交付 |

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

- 个人助理 Phase A 需要落地 IM Gateway、Web Chat、搜索/浏览器连接器和 Agent 组装。
- Console API 基础层未完全统一，存在 `/v1/v1/*` 路径重复和若干返回结构不一致问题；当前只做整理和校准，不把其视为 M11 全量交付。
- `WsServer` 已实现但仍需完成 `runtime-server` 启动接线、鉴权协商与前端订阅联调，这部分作为未来 M11 的输入资产保留。
- 多 Agent 的 `delegate` 结果回流尚未与 `call_tool` 路径形成等价自动续跑闭环，这一点影响 M9 的“完成”口径。
- `docs/05_2026-04-01_memory-evolution/` 是下一阶段主线，后续将进入五层记忆系统的迁移与验证设计。

## 关键风险（历史记录）

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级破坏现有闭环 | 新模块/新策略路径落地 + test harness 回归 |
| session-level lock/CAS 影响 resume/approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 兼容性 | 保留内存 fallback + 增量接入 |
| 当前工作流过多并行导致优先级分散 | 先聚焦个人助理与 Console 准备，再进入记忆系统演进，最后恢复 M11 |
| Console 联调暴露接口契约漂移 | 先统一 API 基础层与类型，M11 恢复后再做页面逐页联调 |
