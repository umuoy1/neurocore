# M11: 运营控制台

> 方向 D · FR-50 ~ FR-55
> 详细设计: [05_operations-console.md](../05_operations-console.md)
> 依赖: 无（独立于 M8/M9/M10，可并行推进）
> 状态: ✅ 当前阶段完成
>
> 2026-04-23 校准说明：
> - `packages/console`、`runtime-server` 与 Console 所需 REST/WS/鉴权/持久会话浏览链路当前阶段已收口。
> - 本文档保留为里程碑验收记录；后续只保留更大范围真实环境联调与后续产品演进，不再作为当前阶段缺口。

---

## M11.1 后端 API 扩展 — P0

- [x] WebSocket 服务器 (`ws-server.ts`): 多频道订阅
- [x] 时序聚合 API: `GET /v1/metrics/timeseries` + `GET /v1/metrics/latency`
- [x] 环形缓冲区指标存储 (`metrics-store.ts`)
- [x] WS 频道: metrics / events / session:{id} / approvals / evals
- [x] WS 心跳: 30s ping，连续 3 次无 pong 断开
- [x] 单元测试: WS 连接/订阅/推送/心跳

## M11.2 Dashboard 概览 (FR-50) — P0

- [x] 5 个核心指标卡片: 活跃 session / 总 cycle / 错误率 / 平均延迟 / eval 通过率
- [x] Cycle 吞吐量时序图
- [x] Health 状态指示灯 (runtime / store / websocket)
- [x] 实时事件流面板 (WebSocket)
- [x] 时间范围选择器 (1h / 6h / 24h / 7d)
- [x] 自动 5s 刷新
- [x] 组件测试

## M11.3 Session 浏览器 (FR-51) — P0

- [x] Session 列表: 按 state / tenant / agent 筛选，分页
- [x] Session 详情: 基本信息 + Goal Tree + Budget + Working Memory
- [x] 运行中 session 实时事件流 (WebSocket)
- [x] 一键跳转到 Trace 可视化
- [x] 组件测试

## M11.4 Trace 可视化 (FR-52) — P0

- [x] Cycle 时间线: 水平展示所有 cycle + 耗时
- [x] Cycle 阶段分解: Perceive → Propose → Evaluate → Decide → Act → Observe → Learn
- [x] Proposal 竞争过程 (competition_log 可视化)
- [x] Prediction vs Observation 对比 + prediction_error 高亮
- [x] Workspace Snapshot 查看器
- [x] 组件测试

## M11.5 Eval 仪表盘 (FR-53) — P1

- [x] Eval run 列表: pass/fail 率 / 耗时 / case 数量
- [x] 两 run 并排对比 (复用 `GET /v1/evals/compare`)
- [x] Pass 率趋势图
- [x] 回归警告 (低于阈值)
- [x] 跳转到关联 session trace
- [x] 组件测试

## M11.6 审批管理 (FR-54) — P1

- [x] 待审批队列实时更新 (WebSocket)
- [x] 一键 approve / reject + 可选 comment
- [x] 审批历史: 按 tenant / 时间 / 审批人筛选
- [x] 上下文弹窗: 完整 workspace snapshot
- [x] 审计日志 API (`GET /v1/audit-logs`)
- [x] 审计日志存储 (`audit-store.ts`)
- [x] 组件测试

## M11.7 配置管理 (FR-55) — P2

- [x] Agent Profile 编辑器: 表单 + JSON 双模式
- [x] Schema 校验和错误提示
- [x] 策略模板 CRUD: `GET/POST/PUT/DELETE /v1/policies`
- [x] 预算配置在线修改
- [x] 工具权限管理: tool_refs 增删 + blocked_tools
- [x] 配置存储 (`config-store.ts`)
- [x] API Key 管理: `GET/POST/DELETE /v1/api-keys`
- [x] RBAC: admin / operator / viewer 三角色
- [x] 组件测试

## M11.8 Frontend Engineering

- [x] 初始化 `packages/console`
- [x] 路由配置: Dashboard / Sessions / Traces / Evals / Approvals / Config
- [x] 状态管理 stores: auth / metrics / sessions / evals / approvals
- [x] API client + WebSocket client
- [x] 租户隔离: 所有数据按 tenant_id 过滤
- [x] 构建配置: lazy loading / 代码分割

## M11.9 Integration & Regression

- [x] E2E 测试: Dashboard → 点击 session → 查看 trace
- [x] 多租户隔离验证
- [x] RBAC 权限验证
- [x] 现有后端测试全部通过
- [x] `tsc --noEmit` 通过

---

## Acceptance Criteria

| # | 条件 |
|---|
| AC-1 | Dashboard 页面 5s 内展示全部核心指标，自动刷新 |
| AC-2 | Session 列表支持筛选分页，详情展示 Goal Tree |
| AC-3 | Trace 时间线展示 cycle + 阶段分解 + competition_log |
| AC-4 | Eval run 列表 + 两 run 对比 + 趋势图 |
| AC-5 | 审批队列实时更新，一键操作 |
| AC-6 | 所有页面按 tenant_id 隔离，RBAC 生效 |
