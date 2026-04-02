# NeuroCore 代码审计清单（2026-04-02）

> 当前项目总进度以 [`docs/README.md`](../README.md) 为准。
>
> 本文档从**现有代码、测试和运行路径**反推当前系统状态，回答四个问题：
> - 当前 Agent 是否达到一个相对完备阶段
> - 各个 Milestone 是否真正完成
> - 主链路是否形成闭环
> - 逻辑是否自洽，架构是否得当

## 审计方法

- 阅读 `protocol / runtime-core / memory-core / multi-agent / world-model / runtime-server / console / sdk-*` 的主链路代码
- 结合测试文件验证“代码存在”与“代码被验证过”是两件不同的事
- 执行 `npm run typecheck`
- 抽样执行 `runtime / skill / device-integration / multi-agent-delegation` 测试

## 验证摘要

- `npm run typecheck`：通过
- M9 定向回归：`npm run build` 后执行 `tests/multi-agent-delegation.test.mjs + tests/multi-agent-runtime.test.mjs`，`20 pass / 0 fail`
- 历史抽样中，hosted runtime 相关失败主要来自当前环境监听 `127.0.0.1` 时触发 `listen EPERM`
- 因此，**本地纯逻辑与 M9 核心闭环已验证**，但 **hosted / socket / Console 联调** 仍需要在允许本地端口监听的环境中完成全量验证

## 总体判断

**如果目标是“有状态单 Agent 认知运行时”，当前代码已经达到一个相对完整、可运行、可恢复、可观测的阶段。**

**如果目标是“完整 Agent 平台 / 完整多轮个人助理产品 / 完整 Console 产品”，当前代码还没有收口。**

更准确地说：

- `single-agent + tool + memory + checkpoint + replay + eval` 已形成主闭环
- `device/world-model` 已接入主链路
- `multi-agent` 已具备核心原语，且本地 in-process 路径已形成闭环
- `console` 有预实现，但还不是产品级闭环
- `personal-assistant / memory-evolution / M10 / M12` 目前仍主要停留在设计与排期层

## Milestone 审计清单

状态说明：

- `✅` 完成
- `◐` 主体完成 / 部分闭环
- `⏸` 延后
- `⬜` 未开始

| Milestone | 结论 | 代码判断 | 主要依据 |
|---|---|---|---|
| M0 | ◐ | 协议包、类型、事件、基础构建已具备；未确认完整 JSON Schema / OpenAPI 生成链 | `packages/protocol`、workspace scripts |
| M1 | ✅ | 单 Agent Session 的最小运行闭环已经形成 | Session/Goal/Cycle/Action/Observation 主链路可跑通 |
| M2 | ✅ | 工具、记忆、门控、审批都已进入运行时主链路 | ToolGateway + Working/Episodic + Meta/Policy |
| M3 | ✅ | Trace / Replay / Eval 已落地并可消费 | ReplayRunner + EvalRunner + baseline evals |
| M4 | ✅ | SDK 与 Runtime Server 主体已落地 | `sdk-core` + `runtime-server` + remote client |
| M5 | ◐ | 可选增强中多数已落地，但不是严格封版里程碑 | predictor / skill / sdk-node / console 预实现 |
| M5.1 | ✅ | 仲裁层升级已落地 | Workspace competition + MetaController |
| M5.2 | ✅ | 预测闭环已落地 | prediction store + error compute + predictor feedback |
| M5.3 | ✅ | 技能系统已落地 | procedural promotion + skill match/execute |
| M6 | ✅ | Hosted Runtime 核心完成，但 hosted E2E 需在可监听端口环境验证 | HTTP API / auth / persistence / replay / eval API |
| M7 | ✅ | 测试、CI、release workflow 已落地 | GitHub Actions + changesets |
| M8 | ✅ | 世界模型与设备接入已接入主链路且有集成验证 | device-core + world-model + perceive/simulate |
| M9 | ◐ | 多 Agent 本地/in-process 核心闭环已完成；剩余缺口主要在分布式与生产化增强 | registry / bus / delegator / coordination / mesh / runtime-server 接入已打通 |
| M10 | ⬜ | 未见技能强化学习实现 | 仅文档与排期存在 |
| M11 | ⏸ / ◐ | Console 已有方案与预实现，但未形成产品闭环 | 页面、store、REST、WS 仍待联调 |
| M12 | ⬜ | 未开始 | 依赖 M9 + M10 收口 |

## 代码层关键结论

### 1. 主运行时闭环已经成立

以下链条在代码中是连续的：

`input -> goal decomposition -> cycle -> proposal/action -> policy/meta decision -> execution -> observation -> prediction error -> episode -> memory -> trace/checkpoint -> persist/resume`

对应实现：

- `CycleEngine` 负责感知、记忆召回、技能召回、reasoner、prediction、policy、workspace、meta decision
- `AgentRuntime` 负责 session 生命周期、action 执行、observation 写入、trace/checkpoint/persist、resume
- `GoalManager` 与 `SessionManager` 提供了较清晰的状态机边界

这说明当前系统不是“若干模块并列存在”，而是已经存在一个能真正运转的核心调度器。

### 2. 逻辑总体自洽，M9 的本地核心闭环已经成立

此前 `call_tool` 路径可以自动续跑，但 `delegate` 路径虽然会记录 observation，却没有被提升到同等级续跑语义。

当前代码已经补上以下缺口：

- `delegate` observation 会像 `call_tool` 一样自动回流到下一轮推理
- `auction` 不再只停在 bid 选择，而会真正执行中标 worker
- `sdk-core` 新增共享 multi-agent infrastructure 注入与 in-process mesh
- `runtime-server` 已可自动装配多 Agent mesh，而不是只停留在单 Agent builder 列表
- 新增 runtime 级测试，验证 supervisor -> worker -> result -> supervisor resume 的端到端链路

因此，M9 更准确的状态应是“**本地核心闭环已完成，分布式/生产化增强后置**”。

### 3. Console 还处在预实现阶段，不应视为 M11 完成

当前 Console 的状态更接近：

- 有 SPA 骨架
- 有 dashboard/session/trace/memory/workspace/world-model 等页面
- 有 Zustand store 和前后端契约草稿
- 有 `WsServer`、metrics/config/audit store 等后端支持资产

但仍存在明确缺口：

- API 路径存在 `/v1/v1/*` 重复问题
- `WsServer` 已实现，但 `runtime-server` 启动接线仍未收口
- 多个页面直接写明“需要后端端点”
- 前后端若干 response shape 和字段命名不一致

所以，当前的 Console 应被视为“**后续 M11 的输入资产**”，而不是“已完成交付”。

### 4. 架构方向是对的，但中心编排器已经偏重

当前架构的优点：

- 包边界清晰：`protocol / runtime-core / memory-core / world-model / multi-agent / runtime-server / console`
- 安全、恢复、回放、评估被放在核心链路，而不是事后补丁
- 世界模型、多 Agent、技能系统都通过 SPI/模块注入方式接入，而不是直接耦合在 reasoner 中

当前架构的主要风险：

- `AgentRuntime` 体量已经很大，后续若继续把产品逻辑堆进 runtime，会变成难维护的中心对象
- `RuntimeServer` 也在向“单文件聚合一切 API 逻辑”发展
- `UserInput` 仍是简单字符串输入模型，更像“任务 runtime”，而不是成熟的多轮 assistant 会话协议
- `AgentBuilder` 当前更像 runtime factory；没有共享 state store 时，`connectSession()` 的局部语义并不稳固

## 闭环判断

### 已闭环

- 本地单 Agent 运行
- 工具调用后的自动续跑
- 工作记忆 / 情景记忆写入与回放
- procedural skill promotion
- trace / replay / eval
- checkpoint / restore / persisted session hydration
- device/world-model 注入后的 perceive/simulate 路径

### 半闭环

- hosted runtime 端到端链路
- console 数据面与订阅面

### 未闭环

- 个人助理产品层
- 五层记忆系统演进
- 技能强化学习
- 通用自主体能力

## 按优先级排序的真实待办

以下待办按“对当前主线的价值”和“对现有代码闭环的补强程度”排序。

### P0：当前主线

1. 个人助理 Phase A 落地
   - 新增 `im-gateway`
   - 新增 `service-connectors`
   - 新增 Web Chat / 搜索 / 浏览器连接器
   - 完成 Agent 组装与基础运行路径

2. Console 准备项收口
   - 统一 API 基础层路径规则和 response shape
   - 接通 `runtime-server` 的 WS 启动接线、鉴权约定和前端订阅
   - 校准前后端字段命名与类型定义
   - 把当前已存在但未接入的后端能力整理为稳定契约

### P1：补足当前代码最真实的内核缺口

1. 收紧 `runtime-server` 与 Console 的联调契约
2. 给 hosted / WS / Console 相关路径补一轮可在真实环境执行的回归验证
3. 为分布式 bus / 多实例 registry / 生命周期隔离补生产化实现

### P2：下一阶段

1. 进入 `docs/05_2026-04-01_memory-evolution/`
2. 定义五层记忆系统迁移边界
3. 明确哪些现有 memory provider 保留，哪些替换，哪些需要兼容层

### P3：未来项

1. M10 技能强化学习
2. M11 Console 正式恢复实施与 E2E 收口
3. M12 通用自主体

## 建议的对外口径

对当前代码最准确的描述应是：

**NeuroCore 已经具备较完整的认知运行时内核，M1 ~ M8 基本成立，M9 的本地多 Agent 核心闭环已形成；M10 / M11 / M12 还不是完成态。当前主线仍是个人助理产品层与 Console 准备，随后进入记忆系统演进。**
