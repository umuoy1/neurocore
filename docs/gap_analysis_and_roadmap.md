# NeuroCore 差距分析与后续路线图

## 1. 当前完成度评估

> 基于 2026-03-27 代码状态，对照 docs/ 架构目标的综合判断。

### 1.1 总体结论

现有代码处于 **MVP+ 原型** 状态：主运行闭环已跑通，11 个测试全绿，已跨过"能否运行"阶段，但离 docs 里"六模块并行认知系统"和企业级产品化还有一轮大工程。

| 参照基准 | 完成度 |
|---|---|
| `agent_sdk_mvp_implementation_plan.md` MVP 定义 | ~85% |
| `agent_sdk_requirements.md` 第一阶段 FR 清单 | ~70%~75% |
| `NeuroCore_Agent_Architecture.md` 六模块完整目标 | ~45%~50% |

### 1.2 六模块完成度

| 模块 | 对应神经科学映射 | 完成度 | 状态说明 |
|---|---|---|---|
| Cortex / Reasoner | 大脑皮层 | 70% | LLM reasoner、plan/respond、OpenAI-compatible adapter 都有，但多模态和高级推理策略未做 |
| Hippocampal / Memory | 海马体 | 65% | working/episodic/semantic 三层已有，但检索权重、写入策略偏简化 |
| Cerebellar / World Model | 小脑 | 20% | 只有 predictor SPI 和 demo，无前向模拟、预测误差回写、世界状态更新闭环 |
| Amygdala / Motivation-Risk | 杏仁核 | 15%~20% | 只有轻量风险/审批启发式，无好奇心/紧迫性/风险厌恶建模 |
| Basal Ganglia / Skill | 基底神经节 | 30%~35% | 有 skill match proposal，无 procedural memory、技能版本化、编译执行 |
| Prefrontal / Meta | 前额叶 | 40%~45% | 有 gate 和 approval，但冲突检测、资源分配、置信度体系很弱 |
| Global Workspace | 全局工作空间 | 45%~50% | 有 workspace snapshot，无真正竞争广播机制，预算检查仍是"候选 action 数量 < 20" |

### 1.3 已实现部分（稳固）

- **协议与分层**：protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core 均有实装
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory/Trace/Checkpoint 全链路打通
- **Goal Tree**：root goal、分解、父子状态派生、resume 时 root goal rebase 均已实现
- **Tool Gateway**：注册、超时、重试、失败观测、执行指标
- **记忆三层**：working + episodic + semantic 轻量实现，支持 cross-session recall
- **托管 Runtime**：HTTP API、async/stream、SSE、webhook、文件/SQLite 持久化、远程 client
- **Trace / Replay / Eval**：完整闭环

### 1.4 主要差距

| 差距 | 影响 | 优先级 |
|---|---|---|
| Global Workspace 是快照汇总而非竞争广播 | 多模块并行认知能力缺失 | P0 |
| MetaController 只是"选第一个未 block 的 action" | 置信度、冲突检测、升级决策体系缺失 | P0 |
| Predictor 无完整闭环（预测记录、误差回写、策略修正） | 世界模型能力为零 | P1 |
| Skill 只有 match proposal，无 procedural 执行 | 技能积累能力缺失 | P1 |
| Policy/Budget 仍是 demo 级（无 token/cost/tool quota） | 无法用于生产 | P1 |
| 无 auth、tenant isolation、remote eval API | 企业级产品化缺失 | P2 |
| 无测试 CI、无观测导出、无管理面 | 运营/调试/回归能力弱 | P2 |

---

## 2. 后续里程碑规划

接续 TODO.md 中的 Milestone 5/6/7，细化为以下四个阶段。

### Milestone 5.1：仲裁层升级（Meta + Workspace）

**目标**：把"启发式选 action"升级为真正的仲裁和竞争广播机制。

**交付物**：
- `WorkspaceCoordinator`：实现模块竞争机制，支持广播-竞争-选择三阶段
- `MetaController`：接入置信度评分、冲突检测、升级决策（对应 FR-20/21/22）
- 预算检查：从"候选 action 数量"升级为 token/cost/tool 多维 quota
- Policy 配置：支持 allow/deny bundle 和租户级规则

**验收标准**：
- 两个模块提出冲突 action 时，MetaController 能基于置信度做选择
- 超出 token/cost quota 时 session 能正确终止或降级
- Policy bundle 可注册并被执行路径消费

---

### Milestone 5.2：预测闭环（Cerebellar / World Model）

**目标**：把 predictor 从 SPI 接口升级为完整预测-误差-修正闭环。

**交付物**：
- `PredictionStore`：记录每次预测与实际观测的对比
- `PredictionError` 回写：cycle-engine 在 observation 阶段写入误差
- 策略修正接口：predictor 误差可触发 policy 调整或 goal 重估
- 至少一个规则型世界模型实现（状态图或条件预测）

**验收标准**：
- 每个 cycle 的预测与结果可在 trace 中查询
- 连续预测误差超阈值时，MetaController 能感知并调整策略

---

### Milestone 5.3：技能系统（Basal Ganglia / Skill）

**目标**：把 skill 从"匹配提示"升级为可执行的 procedural memory。

**交付物**：
- `SkillExecutor`：skill 不只是 match，能真正 execute 并返回 observation
- `ProceduralMemory`：存储、检索、版本化技能
- 技能写入流程：episode 达到阈值后可自动提炼为技能（可配置开关）
- 技能复用路径：cycle 中优先匹配技能再走 LLM

**验收标准**：
- 相同类型任务第二次执行时，能走技能路径而非重新推理
- 技能执行可被 trace 记录并在 replay 中还原

---

### Milestone 6：产品化补齐（Hosted Runtime）

**目标**：把 runtime-server 升级为可实际使用的托管服务。

**子任务**：

#### 6.1 Remote Eval API
- `POST /evals`：创建 eval run
- eval 报告持久化（SQLite 或文件）
- remote client 绑定 eval API

#### 6.2 认证与租户隔离
- runtime-server 接入基础 auth（API key 或 JWT）
- session 和 approval 路径加租户 ID 隔离
- 审批审计加 reviewer identity

#### 6.3 观测与健康
- 结构化日志（JSON 格式）
- metrics 导出接口（Prometheus 兼容）
- runtime health / saturation 端点

#### 6.4 管理面最小集
- session 和 approval 列表 API（无需完整 UI）
- trace/workspace 查询 API
- eval 报告查询和对比 API

---

### Milestone 7：测试与 CI

**目标**：建立可信赖的回归体系。

**交付物**：
- 单元测试：每个核心模块（WorkspaceCoordinator、MetaController、SkillExecutor、PredictionStore）
- 集成测试：五个 MVP 验收场景（复杂问答、多工具串联、审批、长任务恢复、经验复用）
- CI 流程：build + typecheck + test + eval 基线
- 版本发布流程：changesets + npm publish 自动化

---

## 3. 优先级排序

```
P0（立即启动）：
  - Milestone 5.1：MetaController + Workspace 仲裁层
  - Milestone 5.1：Policy/Budget token/cost quota

P1（仲裁层完成后）：
  - Milestone 5.2：Predictor 预测闭环
  - Milestone 5.3：Skill procedural 执行

P2（核心能力稳定后）：
  - Milestone 6.1：Remote Eval API
  - Milestone 6.2：Auth + 租户隔离
  - Milestone 7：测试与 CI

P3（产品化冲刺）：
  - Milestone 6.3：观测与健康
  - Milestone 6.4：管理面最小集
```

---

## 4. 不做的事（本阶段边界）

- 多 Agent 分布式调度
- 高保真世界状态图（图数据库）
- 技能自动提炼的强化学习
- 完整运营控制台 UI
- 通用 AGI 式自主体能力

---

## 5. 关键风险

| 风险 | 缓解措施 |
|---|---|
| Global Workspace 竞争广播实现复杂，容易破坏现有闭环 | 在新分支实现，有完整集成测试覆盖后再合并 |
| Predictor 闭环引入误差累积，影响 session 稳定性 | 误差回写加开关，默认不修改策略，只记录 |
| Skill 执行路径绕过 LLM，降低灵活性 | 技能执行失败时自动 fallback 到 LLM 推理 |
| Auth/租户改造影响现有 API 兼容性 | 优先做内部隔离，API 层向后兼容 |
