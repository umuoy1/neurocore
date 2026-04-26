# Personal Agent Failed Attempts

> 用途：记录失败方案、回滚原因和禁止重复尝试的路径，作为跨 session 长期记忆。

---

## 2026-04-27

| 任务 | 尝试 | 结果 | 后续规则 |
|---|---|---|---|
| PA2-P0-00 | 使用 YAML 作为机器可读 ledger | 放弃。仓库没有 YAML 解析依赖，引入依赖会让控制面变重 | 使用 `project-ledger.json` 作为单一机器可读真相源 |
| PA2-P0-00 | 初版 `pa:plan-check` 要求所有 string array 非空 | 失败。根任务 `depends_on` 合法为空数组，导致控制面无法自举 | `depends_on` 允许空数组，其它关键数组继续要求非空 |
| PA2-P0-00 | 初版 worktree scope 检查使用 `git status --short` + `trim()` | 失败。首行前导状态空格被吃掉，路径被截断；untracked 目录也没有展开到文件 | 使用 `git status --short -uall` 和 `trimEnd()` |
