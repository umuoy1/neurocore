# NeuroCore 差距分析与后续路线图

> 基于 2026-03-30 代码状态，对照 docs/ 架构目标的校准版评估。

## 1. 当前完成度评估

### 1.1 总体结论

现有代码已经处于 **功能性 MVP 完成 + 早期产品化阶段**：

- 本地 runtime 主闭环已经稳定可跑
- Hosted runtime 的 async / stream / webhook / eval API 已有实现
- 记忆、预算、审批、trace / replay / eval 的基础能力已成型
- 当前主要差距不再是“能否运行”，而是 **仲裁层深度、执行正确性、认证与持久化、观测与发布自动化**

相对几个参照系的当前估计：

| 参照基准 | 完成度 |
|---|---|
| `docs/02_2026-03-27_sdk/06_mvp-implementation-plan.md` MVP 定义 | ~95% |
| `docs/02_2026-03-27_sdk/01_requirements.md` 第一阶段 FR 清单 | ~75%~80% |
| `docs/01_2026-03-27_paradigm/04_neurocore-agent-architecture-full.md` 六模块完整目标 | ~50%~55% |

### 1.2 六模块完成度

| 模块 | 对应神经科学映射 | 完成度 | 状态说明 |
|---|---|---|---|
| Cortex / Reasoner | 大脑皮层 | 70% | LLM reasoner、plan/respond、OpenAI-compatible adapter 已有；多模态、结构化流式输出、高级推理策略未做 |
| Hippocampal / Memory | 海马体 | 70% | working / episodic / semantic 已实现，支持 tenant-scoped cross-session recall 和 retrieval_top_k；TTL、negative learning、procedural memory 未做 |
| Cerebellar / World Model | 小脑 | 20% | predictor SPI 已有，但没有 prediction error 回写和策略修正闭环 |
| Amygdala / Motivation-Risk | 杏仁核 | 25%~30% | 基础 policy / warn-block / approval / budget gate 已有；更细粒度 risk model、tenant-aware approval policy 未做 |
| Basal Ganglia / Skill | 基底神经节 | 30%~35% | skill match proposal 已接入 cycle；没有 skill execute、procedural memory、技能版本化 |
| Prefrontal / Meta | 前额叶 | 80%~85% | policy block、warn->approval、uncertainty-based ranking、configurable threshold、multi-dimensional scoring (salience/confidence/risk)、conflict detection、risk_summary 已有；仍缺 richer reasoning 和 explanation generation |
| Global Workspace | 全局工作空间 | 55%~60% | workspace snapshot、risk/confidence/budget/policy 摘要和 token-aware compression 已有；仍非真正竞争广播机制 |

### 1.3 已实现部分（稳固）

- **协议与分层**：`protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core` 均有实装
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory / Trace / Checkpoint 全链路打通
- **Goal Tree**：root goal、分解、父子状态派生、显式输入 rebase 已实现
- **Tool Gateway**：注册、schema 校验、超时、重试、失败观测、执行指标已实现
- **记忆三层**：working + episodic + semantic 已实现，支持 tenant-scoped cross-session recall
- **预算与压缩**：token/tool/cycle budget assessment、token accounting、graded context compression 已实现
- **托管 Runtime**：HTTP API、async/stream、SSE event stream、webhook、文件/SQLite 持久化、远程 client 已实现
- **Trace / Replay / Eval**：本地 eval runner、remote eval API、session replay 已实现
- **测试与 CI**：本地单元/集成测试、GitHub Actions CI、changesets 配置已存在

### 1.4 主要差距

| 差距 | 影响 | 优先级 |
|---|---|---|
| Global Workspace 仍是快照汇总而非竞争广播 | 多模块并行认知能力缺失 | P0 |
| MetaController 仍主要是风险排序后取第一个候选 | 冲突检测、仲裁、解释性不足 | ~~P0~~ 已完成 |
| `selected_action_id` 无效时仍静默 fallback | 执行正确性风险 | ~~P0~~ 已完成 |
| `Goal.dependencies` 未参与 actionability 判断 | goal ordering 语义未闭环 | ~~P0~~ 已完成 |
| `SessionManager` 无真正 session 级 CAS/lock | 本地/内核层并发安全不足 | ~~P0~~ 已完成 |
| Predictor 无完整误差回写闭环 | 世界模型能力停留在 SPI 级别 | P1 |
| Skill 只有 match，无 execute / procedural memory | 技能积累与复用能力不足 | P1 |
| Hosted runtime 无 auth，eval 报告无 durable persistence | 企业级产品化不足 | P1 |
| 观测与发布自动化不完整 | 运维、调试、持续交付能力不足 | P2 |

## 2. 后续里程碑规划

### Milestone 5.1：仲裁层升级（Meta + Workspace）

**目标**：把“风险排序 + 选第一个”升级为真正的仲裁和竞争广播机制。

**当前已有**：

- `WorkspaceSnapshot` 已可承载 risk / confidence / budget / policy 摘要
- `MetaController` 已支持 policy block、warn->approval、configurable threshold

**剩余交付物**：

- `WorkspaceCoordinator`：实现 broadcast -> compete -> select 三阶段
- `MetaController`：引入 salience / confidence / risk 多维评分、冲突检测、升级决策
- 对 invalid `selected_action_id` 直接报错，而不是 fallback
- 让 `Goal.dependencies` 真正影响可执行性判断

**验收标准**：

- 两个模块提出冲突 action 时，runtime 能给出稳定且可解释的选择
- 无效 `selected_action_id` 会中止当前 cycle，而不是静默执行其他动作
- 带 dependencies 的 goal 能按依赖顺序推进

### Milestone 5.2：预测闭环（Cerebellar / World Model）

**目标**：把 predictor 从 SPI 接口升级为完整预测-误差-修正闭环。

**交付物**：

- `PredictionStore`：记录每次预测与实际观测的对比
- `PredictionError` 回写：在 observation 阶段写入误差
- 策略修正接口：预测误差可触发 policy 调整或 goal 重估
- 至少一个规则型世界模型实现

**验收标准**：

- 每个 cycle 的预测与结果可查询、可回放
- 连续误差超阈值时，MetaController 能感知并改变策略

### Milestone 5.3：技能系统（Basal Ganglia / Skill）

**目标**：把 skill 从“匹配提示”升级为可执行的 procedural memory。

**交付物**：

- `SkillExecutor`：skill 能执行并返回 observation
- `ProceduralMemory`：存储、检索、版本化技能
- 技能写入流程：episode 达到阈值后可提炼为 skill
- skill-first 路径：命中技能时优先复用，再 fallback 到 reasoner

**验收标准**：

- 相似任务第二次执行时，能优先命中 skill 路径
- 技能执行可被 trace 记录并在 replay 中还原

### Milestone 6：Hosted Runtime Productization

#### 6.1 认证与租户治理

- `runtime-server` 接入 API key 或 JWT
- session / approval / trace 路径增加 request-time permission checks
- reviewer policy 与 approval audit identity 细化

#### 6.2 Eval 持久化与控制面

- eval 报告 durable persistence（文件 / SQLite）
- eval run 列表、查询、比较 API
- replay 浏览 API
- session / approval list/filter API

#### 6.3 观测与健康

- 结构化日志（JSON）
- metrics 导出接口
- runtime health / saturation / backlog 指标

### Milestone 7：测试、CI 与发布自动化

**当前已有**：

- GitHub Actions CI：Node 22/24 跑 typecheck + test
- unit/integration tests
- changesets 配置和 release scripts

**剩余交付物**：

- 自动 publish workflow
- 对 hosted runtime 和 socket-bound 测试做环境分层
- 将 optional LLM baseline 从“本地可选”提升为可控的 gated CI lane

## 3. 优先级排序

```text
P0（立即推进）：
  - Meta / Workspace 仲裁层升级
  - selected_action_id hard fail
  - goal dependency ordering
  - SessionManager session-level CAS / lock

P1（P0 完成后）：
  - Predictor 误差闭环
  - Skill execute / procedural memory
  - Hosted runtime auth
  - Durable eval persistence

P2（产品化补齐）：
  - Control-plane query/list/filter APIs
  - Structured logs / metrics / health saturation
  - Automated publish workflow

P3（运营能力增强）：
  - Replay/eval comparison workflows
  - Webhook reliability guarantees
  - Broader remote client hardening
```

## 4. 不做的事（当前阶段边界）

- 多 Agent 分布式调度
- 高保真世界状态图（图数据库）
- 技能自动提炼的强化学习
- 完整运营控制台 UI
- 通用 AGI 式自主体能力

## 5. 关键风险

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级容易破坏现有稳定闭环 | 先在新模块或新策略路径里落地，并用现有 test harness 回归 |
| session-level lock/CAS 改造会影响 resume / approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 引入兼容性问题 | 先保留内存实现作 fallback，再增量接入 file/SQLite store |
| auth / tenant permission 改造影响现有 API 使用方式 | 优先增加可选 middleware / headers 方案，分阶段收紧 |

## 6. 结论

这次校准后的判断是：

- NeuroCore 已不再是“能否跑通”的原型，而是 **MVP 功能完成、进入硬化和产品化阶段**
- 旧文档里低估代码进度的部分，主要集中在 **MVP 收尾、Remote Eval API、验收测试覆盖**
- 当前真正阻碍下一阶段演进的，不是缺“更多 demo”，而是缺 **更严格的执行正确性、仲裁层深度、auth / persistence / observability**
