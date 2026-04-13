# NeuroCore LongMemEval Benchmark 接入说明

> 日期：2026-04-12
> 状态：已接入仓库主干
> 目标：用 LongMemEval 为当前记忆系统提供可重复的 retrieval benchmark 主线

---

## 1. 为什么接入

`03_memory-system-architecture.md` 的验证计划要求在记忆系统演进阶段建立一条能够反映长期记忆真实收益的 benchmark 主线。当前代码已经完成 SQL-first 记忆存储迁移，但还缺少一个统一、外部可复现的 benchmark 入口。

LongMemEval 正好覆盖：

- 单 session 记忆提取
- 多 session 联合回忆
- 时间相关问题
- knowledge update
- abstention

对当前代码基线来说，它最适合先承担 **episodic retrieval benchmark**，而不是直接替代完整 QA judge。

---

## 2. 当前接入范围

当前仓库内已接入：

- LongMemEval dataset loader
- official dataset bundle loader（支持文件、目录、递归目录扫描；`requireFullBundle` 按官方 cleaned 数据包校验 `longmemeval_oracle.json / longmemeval_s_cleaned.json / longmemeval_m_cleaned.json`，同时兼容 `longmemeval_s.json / longmemeval_m.json` 旧文件名）
- LongMemEval retrieval benchmark runner
- multi-split benchmark suite runner
- multi-granularity matrix runner（同一次批跑输出 `session + turn`）
- aggregate report（跨 split 汇总 `case_count / recall / mrr / question_type_metrics`）
- LongMemEval official `jsonl` hypothesis 导出格式
- LongMemEval official retrieval log 导出格式
- 基于 `EpisodicMemoryProvider` 的 NeuroCore adapter
- `session / turn` 两种 granularity
- in-memory 与 SQLite-backed 两种 retrieval 路径
- full-bundle smoke 脚本与标准化报告落盘
- official retrieval / QA evaluator wrapper script
- 仓库内 sample fixture 与 deterministic test

当前**没有**在仓库内直接嵌入：

- 官方 GPT judge
- 官方 full generation pipeline
- dense embedding baseline 复现

原因是这三类能力分别依赖外部模型、外部评估凭证或额外推理栈，不适合成为本仓库默认 unit benchmark 的一部分。

当前仓库已经补上的，是“对官方流程的桥接层”：

- retrieval：导出 official retrieval log，并直接调用官方 `print_retrieval_metrics.py`
- QA：接受已有 hypothesis `jsonl`，直接调用官方 `evaluate_qa.py / print_qa_metrics.py`

当前默认会优先使用仓库内 vendored 的官方 evaluator 脚本：

- `tools/longmemeval-official/src/evaluation/print_retrieval_metrics.py`
- `tools/longmemeval-official/src/evaluation/evaluate_qa.py`
- `tools/longmemeval-official/src/evaluation/print_qa_metrics.py`

因此，只要本地提供了官方仓库、数据文件和必要的评估凭证，就可以直接走官方脚本，而不是继续用自定义 summary 代替官方输出。

---

## 3. 代码落点

### 3.1 Eval Core

`packages/eval-core/src/longmemeval.ts`

包含：

- `LongMemEval` 数据类型
- dataset 解析与加载
- benchmark report 结构
- retrieval benchmark runner
- official prediction `jsonl` 导出
- `NeuroCoreLongMemEvalRetriever`

### 3.2 样例与测试

- sample fixture：`tests/fixtures/longmemeval-sample.json`
- benchmark test：`tests/longmemeval-benchmark.test.mjs`
- demo script：`examples/demo-longmemeval-benchmark.mjs`
- full-run script：`examples/demo-longmemeval-full-benchmark.mjs`
- official retrieval wrapper：`examples/demo-longmemeval-official-retrieval.mjs`
- official QA wrapper：`examples/demo-longmemeval-official-qa-eval.mjs`
- hypothesis generation：`examples/demo-longmemeval-generate-hypotheses.mjs`

### 3.3 运行入口

```bash
npm run benchmark:longmemeval
```

默认读取仓库内 sample fixture。

完整目录批跑入口：

```bash
npm run benchmark:longmemeval:full
```

它会读取 `LONGMEMEVAL_DATASET_DIR`，要求目录中存在完整 official bundle，并默认输出到 `.neurocore/benchmarks/longmemeval/<timestamp>/`。

默认会直接使用仓库内 vendored official evaluator；如果本地已经 clone 了官方 `LongMemEval` 仓库，也可以通过 `LONGMEMEVAL_REPO_DIR` 或 `--repo` 显式切过去：

```bash
LONGMEMEVAL_REPO_DIR=/path/to/LongMemEval \
LONGMEMEVAL_DATASET_DIR=/data/LongMemEval \
npm run benchmark:longmemeval:official:retrieval
```

```bash
LONGMEMEVAL_REPO_DIR=/path/to/LongMemEval \
npm run benchmark:longmemeval:official:qa -- \
  --hypotheses /path/to/hypothesis.jsonl \
  --reference /data/LongMemEval/longmemeval_oracle.json \
  --model gpt-4o
```

如果不显式传 `OPENAI_API_KEY`，官方 QA wrapper 和 hypothesis generation 会默认读取 `.neurocore/llm.local.json` 的：

- `apiUrl`
- `bearerToken`
- `model`

也可以显式指定：

```bash
node examples/demo-longmemeval-benchmark.mjs <dataset.json|dataset_dir> [session|turn] [topK] [sqlite.db] [output.json]
```

示例：

```bash
node examples/demo-longmemeval-benchmark.mjs tests/fixtures/longmemeval-sample.json turn 3 /tmp/longmemeval.sqlite /tmp/longmemeval-report.json
```

也支持具名参数：

```bash
node examples/demo-longmemeval-benchmark.mjs \
  --dataset /data/LongMemEval \
  --granularity both \
  --top-k 10 \
  --sqlite-dir /tmp/longmemeval-sqlite \
  --output /tmp/longmemeval-matrix.json \
  --output-dir /tmp/longmemeval-reports \
  --require-full-bundle
```

当 `--dataset` 指向目录时，runner 会自动识别并依次运行目录下存在的官方文件：

- `longmemeval_oracle.json`
- `longmemeval_s_cleaned.json`
- `longmemeval_s.json`
- `longmemeval_m.json`
- `longmemeval_m_cleaned.json`

---

## 4. 与当前记忆系统的映射

LongMemEval 的原始目标是“长时交互记忆的 assistant benchmark”，但当前仓库的第一阶段接入更聚焦于**记忆检索本身**。

映射关系如下：

- `haystack_session`
  - 映射为一个或多个 synthetic `Episode`
- `session granularity`
  - 每个 haystack session 映射为一个 synthetic episode
- `turn granularity`
  - 每个 haystack turn 映射为一个 synthetic episode，并在 metadata 中保留 `session_id / turn_index / has_answer`
- `answer_session_ids`
  - 作为 session-level recall ground truth
- `turn.has_answer`
  - 作为 turn-level recall ground truth

当前 benchmark 直接评估的是：

- `session_recall_at_k`
- `session_mrr`
- `turn_recall_at_k`
- `turn_mrr`
- `question_type_metrics`
- per-split aggregate
- session/turn 双粒度 matrix summary

当前还支持一条完整的 QA 闭环：

1. 用 `examples/demo-longmemeval-generate-hypotheses.mjs` 生成 official `hypothesis.jsonl`
2. 用 `examples/demo-longmemeval-official-qa-eval.mjs` 直接调用官方 evaluator

---

## 5. 为什么当前先做 retrieval benchmark

这是一个刻意的阶段化选择。

当前代码的长期记忆主链，真正已经稳定落到工程里的，是：

- tenant-scoped episodic recall
- SQL-first episodic persistence
- recall 排序与 cross-session 复用

而 LongMemEval 的官方 QA 评估还依赖外部 judge。把 judge 直接绑进仓库会带来：

- API key 依赖
- 非确定性回归
- CI 复杂度上升

因此当前接入策略是：

1. 先把 retrieval benchmark 主线接稳
2. 支持导出 official `jsonl`
3. 如需 full QA correctness，再把导出的 hypothesis 交给外部 official evaluator

---

## 6. 当前验收标准

- sample fixture 可通过 session-granularity benchmark
- sample fixture 可通过 turn-granularity benchmark
- SQLite-backed episodic retrieval 路径可跑通 LongMemEval benchmark
- benchmark runner 能输出稳定的 retrieval report
- benchmark runner 能对完整 official bundle 做 split-level + aggregate-level 报告
- CLI/full-run script 能输出 `matrix/suite/aggregate` 三类报告文件
- official retrieval wrapper 能直接调用官方 `print_retrieval_metrics.py`
- official QA wrapper 能直接调用官方 `evaluate_qa.py / print_qa_metrics.py`
- official `jsonl` 导出格式与 LongMemEval README 要求一致

---

## 7. 后续演进

下一步优先级：

1. 在本地提供官方 full dataset 后，执行一轮真实全量 benchmark，并固化基线结果
2. 加一层 answerer adapter，把 retrieval 结果喂给 reader model，生成 hypothesis
3. 对接官方 QA evaluator，形成 retrieval + QA 的双报告
4. 对比当前 sparse retrieval 与未来 dense retrieval/embedding backend 的增益
