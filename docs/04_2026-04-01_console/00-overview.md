# NeuroCore Operations Console — 总览

## 目标

为 NeuroCore 认知智能体运行时提供一套**独立的 Web 管理控制台**，能够：

1. **全链路穿透** — 从宏观指标到单次认知周期的每一步决策，均可下钻查看
2. **高信息密度** — 单屏展示多维度数据，减少页面跳转
3. **高交互度** — 筛选、搜索、时间轴回放、审批操作、配置编辑一应俱全
4. **实时感知** — WebSocket 推送，Agent 运行状态秒级更新
5. **独立部署** — SPA 包，零侵入现有 runtime 代码，仅通过 REST + WS 通信

## 功能需求编号

| FR | 名称 | 优先级 | 对应文档 |
|---|---|---|---|
| FR-50 | Dashboard 实时指标 | P0 | [04-dashboard.md](04-dashboard.md) |
| FR-51 | Session 浏览器 | P0 | [05-session-browser.md](05-session-browser.md) |
| FR-52 | Cycle Trace 可视化 | P0 | [06-trace-viewer.md](06-trace-viewer.md) |
| FR-53 | Eval 面板 | P1 | [13-eval-dashboard.md](13-eval-dashboard.md) |
| FR-54 | 审批管理 | P1 | [14-approval-center.md](14-approval-center.md) |
| FR-55 | 配置管理 | P2 | [15-config-editor.md](15-config-editor.md) |

除上述 FR 外，本设计还覆盖：Goal Tree、Memory Inspector、Workspace Inspector、Multi-Agent Dashboard、World Model Viewer、Device Panel。

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | React 19 + TypeScript | 生态成熟，类型安全 |
| 构建 | Vite 6 | HMR 快，配置简洁 |
| 样式 | Tailwind CSS 4 | 原子化，高定制性 |
| 状态管理 | Zustand 5 | 轻量，无 boilerplate |
| 图表 | Recharts 2 | React 原生，声明式 API |
| JSON 编辑 | Monaco Editor | 语法高亮、校验、自动补全 |
| 路由 | React Router 7 | Lazy loading，代码分割 |
| 实时通信 | WebSocket | 双向通信，客户端主动订阅 |

## 架构原则

```
┌─────────────────────────────────────────────┐
│           packages/console (SPA)             │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Zustand  │  │ React    │  │ WS Client  │  │
│  │ Stores   │←─│ Pages &  │←─│ (subscribe │  │
│  │ (12个)   │  │ Comps    │  │  + command) │  │
│  └────┬─────┘  └──────────┘  └─────┬──────┘  │
│       │ REST                       │ WS      │
└───────┼────────────────────────────┼─────────┘
        │                            │
        ▼                            ▼
┌─────────────────────────────────────────────┐
│        packages/runtime-server               │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ REST API │  │ WS       │  │ 新增 Store │  │
│  │ (已有+扩展)│  │ Server   │  │ (Metrics/ │  │
│  │          │  │ (新增)    │  │  Audit/   │  │
│  └──────────┘  └──────────┘  │  Config)  │  │
│                              └───────────┘  │
└─────────────────────────────────────────────┘
```

- **不依赖任何 runtime 包** — 所有类型从 protocol 规格本地重建
- **API-first** — 所有数据通过 REST 获取或 WebSocket 推送
- **多租户隔离** — WS 订阅基于认证 tenant_id 自动过滤
- **渐进式** — 只读优先，写入操作（审批、配置）后续补齐

## 文档索引

| # | 文档 | 内容 |
|---|---|---|
| 01 | [包结构](01-package-structure.md) | 目录布局、依赖声明、构建配置 |
| 02 | [WebSocket 协议](02-websocket-protocol.md) | 消息格式、通道、命令、心跳、租户隔离 |
| 03 | [状态管理](03-state-management.md) | 12 个 Zustand Store 设计 |
| 04 | [Dashboard](04-dashboard.md) | 指标卡片、吞吐图、健康面板、实时事件流 |
| 05 | [Session 浏览器](05-session-browser.md) | 列表、详情、预算、策略、事件流 |
| 06 | [Trace 查看器](06-trace-viewer.md) | 时间轴、阶段分解、竞争日志、预测对比 |
| 07 | [Goal Tree](07-goal-tree.md) | 层级树、状态着色、依赖、筛选搜索 |
| 08 | [Memory 检查器](08-memory-inspector.md) | 四层记忆浏览 |
| 09 | [Workspace 检查器](09-workspace-inspector.md) | 快照钻取、竞争日志、风险评估 |
| 10 | [Multi-Agent](10-multi-agent.md) | 注册表、委派、协调、心跳、拍卖 |
| 11 | [World Model](11-world-model.md) | 实体-关系图、冲突、查询过滤 |
| 12 | [Device Panel](12-device-panel.md) | 传感器/执行器卡片、读数图表 |
| 13 | [Eval 面板](13-eval-dashboard.md) | 运行管理、趋势、对比、回归检测 |
| 14 | [审批中心](14-approval-center.md) | 队列、历史、审计日志 |
| 15 | [配置编辑器](15-config-editor.md) | Profile 表单/JSON、策略模板、API Key |
| 16 | [后端扩展](16-backend-extensions.md) | 新 REST 端点、WS Server、Store |
| 17 | [实施分期](17-implementation-sequence.md) | P0→P1→P2 分期计划 |
