# MVP 交付记录

> 当前进度跟踪已迁移至 [`docs/README.md`](../README.md)，本文档为历史交付记录。

## 交付总结

MVP 及全部 post-MVP 目标已全部交付。255 个测试全部通过，六模块整体完成度 ~90%。

## MVP 验收条件

| # | 条件 | 交付物 |
|---|---|---|
| 1 | 开发者可以定义 Agent | `defineAgent()` + 工具/记忆/策略/预测器/技能注册 |
| 2 | Session 可以创建、恢复、完成 | 含 resume、checkpoint、goal rebase、approval resume |
| 3 | Runtime 可以执行标准认知周期 | `CycleEngine` 主链路 |
| 4 | Agent 可使用目标栈、工具、记忆 | goal tree + tool gateway + 四层记忆 + procedural 自动提炼 |
| 5 | 高风险动作有基础门控 | warn/block policy + approval flow + 多维 budget |
| 6 | 运行过程可追踪、可回放、可评估 | trace / replay / eval runner / remote eval API |

## MVP 交付清单

Protocol Schema · Agent Builder · Session Runtime · Goal Stack · Workspace Snapshot（含竞争广播）· Tool Gateway · Working Memory · Episodic Memory · Semantic Memory · Procedural Memory（含 skill 自动提炼）· Meta Controller · Trace Store · Replay Runner · Eval Harness

## 验收场景

| 场景 | 测试位置 |
|---|---|
| 复杂问答 + 澄清 | `tests/mvp-scenarios.test.mjs` B1 |
| 多工具串联任务 | `tests/mvp-scenarios.test.mjs` B2 |
| 高风险工具审批 | `tests/mvp-scenarios.test.mjs` B3 |
| 长任务恢复 | `tests/runtime.test.mjs` input rebase / resume |
| 经验复用 | `tests/mvp-scenarios.test.mjs` B4 |
