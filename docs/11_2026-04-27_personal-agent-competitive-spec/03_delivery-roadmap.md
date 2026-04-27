# Personal Agent Delivery Roadmap

> 日期：2026-04-27
> 目标：把个人助理竞争规格拆成可长期执行的阶段、任务、依赖和交付边界。
> 机器可读真相源：[`project-ledger.json`](./project-ledger.json)
> 下一轮产品化路线：[`10_gap-requirements-and-execution-plan.md`](./10_gap-requirements-and-execution-plan.md)

---

## 1. 路线原则

| 原则 | 要求 |
|---|---|
| Phase gate | 不完成前一阶段验收，不进入下一阶段批量实现 |
| One active task | 同一时间最多一个 `in_progress` 任务 |
| Acceptance first | 每个任务必须先写验收和测试，再写代码 |
| Design ref required | 每个任务必须引用本目录设计文档中的具体条目 |
| Git checkpoint | 每个任务验收后形成 task commit；每个 Phase 收口后 push |
| Failed attempt memory | 每个失败方案必须写入 [`08_failed-attempts.md`](./08_failed-attempts.md) |
| Progress as lab notes | 每个完成项必须写入 [`07_progress-log.md`](./07_progress-log.md) |

---

## 2. 阶段总览

| Phase | 名称 | 目标 | 退出条件 |
|---|---|---|---|
| Phase 0 | Control Plane | 建立长任务执行协议、ledger、验收 oracle、测试策略和校验命令 | `npm run pa:plan-check` 通过 |
| Phase 1 | Gateway + Conversation | PersonalGateway、ConversationRouter、WebChat/CLI/IM 统一 ingress，修复短上下文断裂 | 上下文连续性 E2E 通过 |
| Phase 2 | Memory | 显式个人记忆、session search、recall bundle、memory review | 个人记忆 focused tests + LongMemEval smoke 通过 |
| Phase 3 | Command + Governance | slash command、approval、risk policy、tool gating、trace | 高风险命令必须审批，绕过测试失败 |
| Phase 4 | Automation | cron、heartbeat、webhook、background task ledger | 自动任务可恢复、可取消、可投递 |
| Phase 5 | Channels | Telegram、Slack、Discord、Email、Feishu 收口 | 多渠道 E2E smoke 通过 |
| Phase 6 | Extensibility | Skills、MCP、browser、web search、subagents、sandbox | 插件/技能/MCP 权限和回归通过 |
| Phase 7 | Beyond | memory wiki、dreaming、自动技能生成、Console 治理面、benchmark | 个人助理 benchmark 和治理面完整 |

PA2 任务链已完成后，下一轮按 [`10_gap-requirements-and-execution-plan.md`](./10_gap-requirements-and-execution-plan.md) 中的 `PA-GAP-001` ~ `PA-GAP-030` 继续推进。新的执行单位仍沿用本文的 phase gate、acceptance-first、progress log 和 git checkpoint 规则。

---

## 3. P0 任务链

| 任务 | 依赖 | 交付 |
|---|---|---|
| PA2-P0-00 | 无 | 长任务控制平面：文档、ledger、校验脚本、package scripts |
| PA2-P0-01 | PA2-P0-00 | PersonalGateway 抽象和入口规范 |
| PA2-P0-02 | PA2-P0-01 | Conversation handoff 和短指代连续性 |
| PA2-P0-03 | PA2-P0-02 | 显式个人记忆接入 recall bundle |
| PA2-P0-04 | PA2-P0-01 | Command registry 和基础 slash commands |
| PA2-P0-05 | PA2-P0-04 | 工具审批和命令风险分级 |
| PA2-P0-06 | PA2-P0-05 | 最小 background task ledger |
| PA2-P0-07 | PA2-P0-06 | 最小 cron 和 delivery |
| PA2-P0-08 | PA2-P0-04 | Web search/fetch/browser connector 收口 |

---

## 4. P1 任务链

| 任务 | 依赖 | 交付 |
|---|---|---|
| PA2-P1-01 | PA2-P0-02 | Telegram adapter |
| PA2-P1-02 | PA2-P0-02 | Slack adapter |
| PA2-P1-03 | PA2-P0-02 | Discord adapter |
| PA2-P1-04 | PA2-P0-07 | Email adapter 与 webhook/cron 结合 |
| PA2-P1-05 | PA2-P0-04 | Skills registry + AgentSkills 兼容 |
| PA2-P1-06 | PA2-P0-05 | MCP client + tool filtering |
| PA2-P1-07 | PA2-P0-06 | 子 Agent lifecycle 和任务面板 |
| PA2-P1-08 | PA2-P0-03 | hybrid memory search + session search |
| PA2-P1-09 | PA2-P0-05 | Docker/SSH sandbox provider |
| PA2-P1-10 | PA2-P0-07 | heartbeat 和 standing orders |

---

## 5. P2 任务链

| 任务 | 依赖 | 交付 |
|---|---|---|
| PA2-P2-01 | PA2-P1-08 | memory wiki / claim evidence layer |
| PA2-P2-02 | PA2-P2-01 | dreaming / consolidation pipeline |
| PA2-P2-03 | PA2-P1-05 | 自动技能生成和技能回归 |
| PA2-P2-04 | PA2-P1-07 | 多 Agent profile + channel binding |
| PA2-P2-05 | PA2-P1-08 | 轨迹数据、脱敏、benchmark artifact |
| PA2-P2-06 | PA2-P1-04 | 全渠道媒体和语音 |
| PA2-P2-07 | PA2-P1-07 | Console 统一治理视图 |

---

## 6. 每阶段交付格式

每阶段完成时必须更新：

| 文件 | 更新内容 |
|---|---|
| `project-ledger.json` | 状态、完成时间、验收命令、产物路径 |
| `07_progress-log.md` | 本阶段完成项、测试结果、指标、残留风险 |
| `08_failed-attempts.md` | 本阶段失败方案和不再尝试的理由 |
| `docs/README.md` | 如新增文档或入口，更新导航 |
| `docs/03_2026-03-30_assessment/*` | 如改变完成度或剩余待办，更新进度 |
| Git remote | 阶段收口 commit 必须 push 到当前分支 upstream |
