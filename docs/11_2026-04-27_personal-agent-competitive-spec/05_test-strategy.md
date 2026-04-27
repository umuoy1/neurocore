# Personal Agent Test Strategy

> 日期：2026-04-27
> 目标：定义个人助理长任务的测试矩阵、命令分层和回归策略。

---

## 1. 测试分层

| 层级 | 命名 | 范围 | 触发 |
|---|---|---|---|
| Plan tests | `pa:plan-check` | 文档、ledger、协议一致性 | 每次开工前和完成后 |
| Focused unit | `tests/personal-assistant-*.test.mjs` | 单模块逻辑 | 每个任务 |
| Integration | gateway/runtime/memory/tool/policy 接线 | P0/P1 任务 |
| E2E smoke | WebChat/CLI/IM 真实链路 | 每阶段 |
| Safety regression | approval、sandbox、prompt injection、memory injection | 涉及工具/消息/记忆 |
| Benchmark | LongMemEval、memory system benchmark、personal agent benchmark | 记忆和阶段收口 |

---

## 2. 基础命令

| 命令 | 用途 |
|---|---|
| `npm run pa:plan-check` | 校验长任务控制平面 |
| `npm run pa:next-task` | 获取下一个可执行任务 |
| `npm run pa:start -- <task_id>` | 将可执行任务标记为 `in_progress` |
| `npm run pa:task-check -- <task_id>` | 校验任务依赖、设计引用和写入范围 |
| `npm run pa:accept -- <task_id>` | 执行任务声明的验收命令 |
| `npm run build` | TypeScript 构建 |
| `npm run test:unit` | 非外部依赖单元测试 |
| `node --test tests/personal-assistant-*.test.mjs` | 个人助理 focused tests |
| `npm run benchmark:memory` | memory benchmark 聚合 |
| `npm run benchmark:longmemeval:stable -- ...` | LongMemEval stable retrieval |

---

## 3. P0 测试映射

| 任务 | 必须测试 |
|---|---|
| PA2-P0-00 | `npm run pa:plan-check`、`npm run pa:next-task` |
| PA2-P0-01 | gateway envelope unit、WebChat ingress integration、CLI ingress smoke |
| PA2-P0-02 | terminal session handoff、short-reference regression、same chat resume E2E |
| PA2-P0-03 | personal memory command tests、recall bundle injection tests、memory correction tests |
| PA2-P0-04 | command parser tests、cross-channel command parity tests |
| PA2-P0-05 | approval required tests、dangerous command denial tests |
| PA2-P0-06 | task lifecycle tests、cancel tests、lost task reconciliation tests |
| PA2-P0-07 | cron schedule parse tests、pause/resume/run/remove tests、delivery tests |
| PA2-P0-08 | search/fetch/browser trace tests、citation tests、untrusted web content tests |

---

## 4. 测试数据

| 数据集 | 用途 |
|---|---|
| `tests/fixtures/longmemeval-sample.json` | LongMemEval smoke |
| official LongMemEval full dataset | 记忆检索质量回归 |
| personal assistant synthetic conversations | 上下文连续性、命令、记忆、审批 |
| synthetic channel events | 各 IM adapter envelope 和 delivery |
| synthetic webhook payloads | untrusted input 和 policy |
| synthetic cron schedules | one-shot、recurring、timezone、missed run |

---

## 5. CI 分层建议

| Lane | 运行内容 | 触发 |
|---|---|---|
| `pa-plan` | `npm run pa:plan-check` | 所有 PR |
| `pa-focused` | build + personal assistant focused tests | 个人助理相关路径 |
| `pa-safety` | approval / sandbox / injection tests | 工具、消息、MCP、browser 相关路径 |
| `pa-benchmark-smoke` | LongMemEval sample + memory benchmark smoke | memory 相关路径 |
| `pa-e2e-local` | WebChat/CLI local E2E | 手动或 nightly |
| `pa-baseline` | `PA-BL-001` 个人助理完整 Baseline：12 轮主链路、场景矩阵、artifact 和安全门禁 | milestone 收口、provider/runtime/assistant 关键改动 |
| `pa-full-benchmark` | LongMemEval full + personal agent benchmark | milestone 收口 |

---

## 6. 失败处理

| 失败类型 | 处理 |
|---|---|
| 测试缺失 | 不允许标记任务完成，先补 test oracle |
| flaky | 标记为 blocker，写入 progress log，不得静默重试到通过 |
| 外部凭证缺失 | 提供 skip 条件和本地 deterministic substitute |
| benchmark 退化 | 停止功能推进，先定位退化或更新设计 |
| 安全测试失败 | 不得降级验收，必须修复 |

---

## 7. 产品级 Baseline

个人助理完整 Baseline 见 [`09_personal-assistant-baseline-test.md`](./09_personal-assistant-baseline-test.md)。

Baseline 必须作为阶段收口门禁，而不是普通 smoke：

| 项 | 要求 |
|---|---|
| 主链路 | 固定执行 `PA-BL-001` 12 轮问答，覆盖搜索、上下文、记忆、审批、发送、提醒、新会话恢复 |
| 场景矩阵 | deterministic 模式必须覆盖 S1~S12 |
| Artifact | 每次 run 输出 transcript、events、trace、memory、tools、approvals、tasks、metrics、verdict |
| 阻断项 | 上下文反问、审批绕过、旧记忆误召回、provider timeout 崩溃、token 泄漏均为 blocker |
| Live provider | OpenAI-compatible/provider 改动必须跑 live-provider 模式；provider 不可用不得覆盖 accepted baseline |
