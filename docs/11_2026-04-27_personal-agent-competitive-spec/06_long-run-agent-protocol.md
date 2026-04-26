# Long-Run Agent Protocol

> 日期：2026-04-27
> 目的：把个人助理项目从“靠对话推进”变成“靠工程协议推进”。本文档是本目录下长任务执行的最高优先级项目协议。

---

## 1. 开工前强制步骤

每次处理个人助理竞争规格相关任务，必须先执行：

1. 读取本文件。
2. 读取 [`project-ledger.json`](./project-ledger.json)。
3. 运行 `npm run pa:plan-check`。
4. 运行 `npm run pa:next-task`。
5. 如该任务为 `pending`，运行 `npm run pa:start -- <task_id>` 将它标记为 `in_progress`。
6. 只处理输出的当前任务，除非用户明确指定另一个任务。

---

## 2. 执行中强制规则

| 规则 | 要求 |
|---|---|
| One active task | 同时最多一个任务为 `in_progress` |
| No undocumented work | 代码改动必须追溯到 ledger 的 `design_refs` |
| No skipped phase | 不得在依赖未完成时实现下游任务 |
| Tests before done | 任务未通过 `npm run pa:accept -- <task_id>` 不得标记完成 |
| Commit after accept | 每个 ledger task 通过验收后必须由 agent 自己提交 commit |
| Push at phase gate | 每个 Phase 收口后必须由 agent 自己 push；用户明确要求时也可在任务级 push |
| Failed attempts remembered | 失败方案必须写入 `08_failed-attempts.md` |
| Progress logged | 每个完成项必须写入 `07_progress-log.md` |
| No private state | 任务状态只能写入 ledger/progress，不靠对话记忆 |
| No silent scope creep | 发现设计缺口时先更新 docs，再改代码 |

---

## 3. 完成判定

任务只能在同时满足以下条件时标记为 `completed`：

1. 所有依赖任务已经 `completed`。
2. 任务声明的所有 acceptance 项已经满足。
3. 任务声明的所有 tests 命令通过。
4. `npm run pa:task-check -- <task_id>` 通过。
5. `npm run pa:accept -- <task_id>` 通过。
6. `07_progress-log.md` 已记录完成结果。
7. 如有失败方案，`08_failed-attempts.md` 已记录。

---

## 4. Ralph loop 规则

当 agent 认为任务完成时，必须执行：

```bash
npm run pa:accept -- <task_id>
```

如果失败：

1. 不得说任务已完成。
2. 读取失败输出。
3. 修复或更新验收设计。
4. 再次运行。

只有验收命令通过，才允许在最终回复中说“完成”。

---

## 5. 人类中断后的恢复

如果执行被中断，下一次恢复必须：

1. 运行 `git status --short`。
2. 读取 `07_progress-log.md` 最新条目。
3. 读取 `project-ledger.json` 的 `meta.current_task`。
4. 运行 `npm run pa:task-check -- <current_task>`。
5. 判断当前工作树是否属于该任务。
6. 如发现不属于当前任务的未提交改动，不得回滚，先向用户说明。

---

## 6. 提交与推送规则

每个任务完成后，agent 必须自己执行：

1. `npm run pa:accept -- <task_id>`。
2. 更新 `project-ledger.json`、`07_progress-log.md` 和必要文档。
3. 运行 `npm run pa:plan-check`。
4. 创建一个包含 task id 的 commit。

每个 Phase 的全部任务完成后，agent 必须自己执行：

1. 运行该 Phase 的阶段验收命令。
2. 创建 phase 收口 commit，或确认所有 task commit 已存在。
3. `git push` 到当前分支的 upstream。
4. 在 `07_progress-log.md` 记录 commit hash、remote、branch 和 push 结果。

如果用户明确要求任务级 push，则当前 task commit 后立即 push。

commit message 必须包含：

```text
<task_id>: <summary>

Design refs:
- docs/11_2026-04-27_personal-agent-competitive-spec/<doc>.md#...

Validation:
- npm run pa:accept -- <task_id>
```

禁止事项：

| 禁止项 | 原因 |
|---|---|
| 不验收就 commit | 会把失败状态固化到历史 |
| 不记录 progress 就 commit | 下个 session 无法恢复 |
| phase 完成不 push | 远程没有可恢复 checkpoint |
| amend 旧提交 | 会破坏长任务历史，除非用户明确要求 |

---

## 7. 当前长期目标

最终目标不是完成某个 demo，而是交付一个功能覆盖 OpenClaw / Hermes，并在记忆、上下文连续性、治理、自动化、多 Agent 和评测水位上更强的个人助理 agent。
