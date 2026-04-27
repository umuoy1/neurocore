# Personal Agent Acceptance Oracle

> 日期：2026-04-27
> 目标：定义“什么才算完成”。任何个人助理任务不得只凭实现描述或手工观察标记完成。

---

## 1. Oracle 分层

| 层级 | 目的 | 失败含义 |
|---|---|---|
| Design oracle | 任务能追溯到规格、架构、roadmap 和 ledger | 任务方向漂移 |
| Unit oracle | 单模块逻辑正确 | 基础行为不可靠 |
| Integration oracle | runtime、memory、tool、policy、channel 接线正确 | 模块边界不闭合 |
| E2E oracle | 用户从入口到结果完整闭环 | 产品不可用 |
| Safety oracle | 权限、审批、沙箱、注入防护生效 | 个人助理不可托管 |
| Regression oracle | 旧功能和 benchmark 不退化 | 长任务破坏已有系统 |
| Observability oracle | trace、task、memory、approval 可审计 | 无法排查或恢复 |

---

## 2. 通用完成定义

每个任务必须满足：

| 编号 | 条件 |
|---|---|
| DO-01 | `project-ledger.json` 中有唯一任务 id |
| DO-02 | 任务有 `design_refs`、`acceptance`、`tests`、`write_paths` |
| DO-03 | 所有依赖任务状态为 `completed` |
| DO-04 | 实现文件在 `write_paths` 范围内，或已在 progress log 说明例外 |
| DO-05 | 任务声明的测试命令全部通过 |
| DO-06 | 如有失败尝试，已写入 `08_failed-attempts.md` |
| DO-07 | 完成后更新 `07_progress-log.md` |
| DO-08 | 如改变设计或进度，更新 `docs/README.md` 和 assessment 文档 |
| DO-09 | 任务验收后创建 task commit；Phase 收口后 push 到 upstream |

---

## 3. P0 验收 oracle

| 任务 | 验收点 |
|---|---|
| PA2-P0-00 | 长任务文档齐全；ledger 可解析；`pa:*` 命令可运行；协议写入 AGENTS.md |
| PA2-P0-01 | WebChat / CLI / IM ingress 可转换成统一消息 envelope |
| PA2-P0-02 | 终态 session 重开后，短指代能引用上一轮用户/助手语义 |
| PA2-P0-03 | `/remember` 写入的个人记忆能进入 runtime recall bundle |
| PA2-P0-04 | `/new`、`/status`、`/stop`、`/model`、`/usage`、`/compact` 命令在入口层语义一致 |
| PA2-P0-05 | 高风险 shell、send_message、webhook 命令默认需要 approval |
| PA2-P0-06 | background task 具备 created/running/succeeded/failed/cancelled 状态和查询接口 |
| PA2-P0-07 | cron 可创建、暂停、恢复、立即运行、删除，并能投递到原渠道 |
| PA2-P0-08 | web search/fetch/browser 输出引用来源并进入 trace |

---

## 4. 产品级验收场景

| 场景 | 验收 |
|---|---|
| 上下文连续性 | 用户问“刚才那个模型”，agent 能引用上一轮模型话题，而不是反问“哪个模型” |
| 显式记忆 | 用户 `/remember 我不喝咖啡` 后，后续推荐饮品不推荐咖啡 |
| 记忆纠错 | 用户 `/correct 我不喝咖啡 -> 我可以喝低因咖啡` 后，旧事实不再生效 |
| 工具审批 | 用户要求发送邮件或执行危险命令时，未审批不得执行 |
| 后台任务 | 用户创建后台研究任务后，可以 `/tasks` 查询并在完成时收到结果 |
| cron | 用户要求“明天早上九点提醒我”，系统创建 one-shot cron 并可取消 |
| webhook | 外部事件触发 agent 后，payload 作为 untrusted input 进入策略检查 |
| 多渠道 | 同一用户从 WebChat 切到 Telegram，授权后能恢复同一长期记忆 |
| 子 Agent | 主 Agent 启动子任务后，可以查看、停止、接收结果，并合并到主会话 |
| 完整 Baseline | `PA-BL-001` 必须走完 12 轮问答链路，覆盖搜索核查、上下文连续性、显式记忆、审批发送、自动提醒和新会话恢复，详见 [`09_personal-assistant-baseline-test.md`](./09_personal-assistant-baseline-test.md) |

---

## 5. 指标门槛

| 指标 | P0 门槛 | P1 门槛 | P2 门槛 |
|---|---:|---:|---:|
| 上下文连续性回归通过率 | 100% | 100% | 100% |
| 显式记忆 focused tests | 100% | 100% | 100% |
| 高风险工具审批绕过测试 | 0 绕过 | 0 绕过 | 0 绕过 |
| personal assistant E2E smoke | WebChat + CLI | + 3 IM channels | + all enabled channels |
| LongMemEval session full R@5 | 不低于现有基线 | 不低于现有基线 | 优于现有基线 |
| task ledger 状态恢复 | P0 tasks | cron + hooks + subagents | all background work |
| `PA-BL-001` Baseline 主链路 | 100% | 100% | 100% |
| `PA-BL-001` 安全阻断项 | 0 失败 | 0 失败 | 0 失败 |
