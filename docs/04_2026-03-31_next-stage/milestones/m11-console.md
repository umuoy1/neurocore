# M11: 运营控制台

> 方向 D · FR-50 ~ FR-55
> 详细设计: [05_operations-console.md](../05_operations-console.md)
> 依赖: 无（独立于 M8/M9/M10，可并行推进）
> 状态: ⏸ 延后（已有方案与预实现，后续再恢复完整里程碑）
>
> 2026-04-02 排期说明：
> - 仓库中已经存在 `packages/console`、`runtime-server` 扩展和多组 Console 相关预实现。
> - 当前只保留 Console 相关文档、接口契约和后端支持整理，不以“完成 M11 全量交付”为近期目标。
> - 待个人助理产品线与记忆系统演进阶段收口后，再恢复本里程碑的正式联调与验收。

---

## M11.1 后端 API 扩展 — P0

- [ ] WebSocket 服务器 (`ws-server.ts`): 升级 SSE → WS，多频道订阅
- [ ] 时序聚合 API: `GET /v1/metrics/timeseries` + `GET /v1/metrics/latency`
- [ ] 环形缓冲区指标存储 (`metrics-store.ts`)
- [ ] WS 频道: metrics / events / session:{id} / approvals / evals
- [ ] WS 心跳: 30s ping，连续 3 次无 pong 断开
- [ ] 单元测试: WS 连接/订阅/推送/心跳

## M11.2 Dashboard 概览 (FR-50) — P0

- [ ] 5 个核心指标卡片: 活跃 session / 总 cycle / 错误率 / 平均延迟 / eval 通过率
- [ ] Cycle 吞吐量时序图 (ECharts)
- [ ] Health 状态指示灯 (runtime / store / websocket)
- [ ] 实时事件流面板 (WebSocket)
- [ ] 时间范围选择器 (1h / 6h / 24h / 7d)
- [ ] 自动 5s 刷新
- [ ] 组件测试

## M11.3 Session 浏览器 (FR-51) — P0

- [ ] Session 列表: 按 state / tenant / agent 筛选，分页
- [ ] Session 详情: 基本信息 + Goal Tree + Budget + Working Memory
- [ ] 运行中 session 实时事件流 (WebSocket)
- [ ] 一键跳转到 Trace 可视化
- [ ] 组件测试

## M11.4 Trace 可视化 (FR-52) — P0

- [ ] Cycle 时间线: 水平展示所有 cycle + 耗时
- [ ] Cycle 阶段分解: Perceive → Propose → Evaluate → Decide → Act → Observe → Learn
- [ ] Proposal 竞争过程 (competition_log 可视化)
- [ ] Prediction vs Observation 对比 + prediction_error 高亮
- [ ] Workspace Snapshot 查看器
- [ ] 组件测试

## M11.5 Eval 仪表盘 (FR-53) — P1

- [ ] Eval run 列表: pass/fail 率 / 耗时 / case 数量
- [ ] 两 run 并排对比 (复用 `GET /v1/evals/compare`)
- [ ] Pass 率趋势图
- [ ] 回归警告 (低于阈值)
- [ ] 跳转到关联 session trace
- [ ] 组件测试

## M11.6 审批管理 (FR-54) — P1

- [ ] 待审批队列实时更新 (WebSocket)
- [ ] 一键 approve / reject + 可选 comment
- [ ] 审批历史: 按 tenant / 时间 / 审批人筛选
- [ ] 上下文弹窗: 完整 workspace snapshot
- [ ] 审计日志 API (`GET /v1/audit-logs`)
- [ ] 审计日志存储 (`audit-store.ts`)
- [ ] 组件测试

## M11.7 配置管理 (FR-55) — P2

- [ ] Agent Profile 编辑器: 表单 + JSON 双模式
- [ ] Schema 校验和错误提示 (Monaco Editor)
- [ ] 策略模板 CRUD: `GET/POST/PUT/DELETE /v1/policies`
- [ ] 预算配置在线修改
- [ ] 工具权限管理: tool_refs 增删 + blocked_tools
- [ ] 配置存储 (`config-store.ts`)
- [ ] API Key 管理: `GET/POST/DELETE /v1/api-keys`
- [ ] RBAC: admin / operator / viewer 三角色
- [ ] 组件测试

## M11.8 Frontend Engineering

- [ ] 初始化 `packages/console` (React 19 + Vite + Zustand + Ant Design 5)
- [ ] 路由配置: Dashboard / Sessions / Traces / Evals / Approvals / Config
- [ ] 状态管理 stores: auth / metrics / sessions / evals / approvals
- [ ] API client + WebSocket client
- [ ] 租户隔离: 所有数据按 tenant_id 过滤
- [ ] 构建配置: lazy loading / 代码分割

## M11.9 Integration & Regression

- [ ] E2E 测试: Dashboard → 点击 session → 查看 trace
- [ ] 多租户隔离验证
- [ ] RBAC 权限验证
- [ ] 现有后端测试全部通过
- [ ] `tsc --noEmit` 通过

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
