# 审批中心（FR-54）

## 页面路由

`/approvals`

## 布局

三标签页：**Queue**（待处理）、**History**（已处理）、**Audit Log**（审计日志）。

### Queue 标签

```
┌──────────────────────────────────────────────────────────────────────┐
│ Approvals — Queue (3 pending)                  [Refresh]             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌─ appr_x01 ──────────────────────────────────────────────────────┐ │
│ │ Requested 2m ago          [HIGH RISK]                          │ │
│ │ Session: sess_a12  Agent: planner   Tenant: acme              │ │
│ │ Action: call_tool("delete_file", {path: "/data/..."})         │ │
│ │ Side Effect: high   Risk: 0.78                                 │ │
│ │ Review Reason: high side_effect_level requires approval        │ │
│ │                                                                │ │
│ │ [View Context]   [✓ APPROVE]   [✗ REJECT + Comment]           │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ appr_y02 ──────────────────────────────────────────────────────┐ │
│ │ Requested 5m ago          [MEDIUM RISK]                        │ │
│ │ Session: sess_c56  Agent: reviewer  Tenant: beta               │ │
│ │ Action: delegate("external_api_call")                          │ │
│ │ Side Effect: medium                                             │ │
│ │                                                                │ │
│ │ [View Context]   [✓ APPROVE]   [✗ REJECT + Comment]           │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### History 标签

```
┌──────────────────────────────────────────────────────────────────────┐
│ Approvals — History                                                  │
├──────────────────────────────────────────────────────────────────────┤
│ Filter: [Decision ▼] [Approver ▼] [Tenant ▼] [Date Range]          │
├──────────────────────────────────────────────────────────────────────┤
│ Approval ID │ Session │ Action          │ Decision │ Approver │ Time │
│ appr_x01    │sess_a12 │ call_tool(del)  │ approved │ admin_01 │ 14:25│
│ appr_z99    │sess_d78 │ delegate(ext)   │ rejected │ admin_02 │ 14:20│
│ appr_w55    │sess_e90 │ call_tool(post) │ approved │ admin_01 │ 14:15│
└──────────────────────────────────────────────────────────────────────┘
```

### Audit Log 标签

```
┌──────────────────────────────────────────────────────────────────────┐
│ Audit Log                                            [Export CSV]     │
├──────────────────────────────────────────────────────────────────────┤
│ Filter: [Action Type ▼] [Tenant ▼] [User ▼] [Date Range]           │
├──────────────────────────────────────────────────────────────────────┤
│ Time     │ Tenant │ User     │ Action         │ Target    │ Details  │
│ 14:25:01 │ acme   │ admin_01 │ approval.approve │ appr_x01 │ ...    │
│ 14:20:15 │ beta   │ admin_02 │ approval.reject  │ appr_z99 │ "Risk.."│
│ 14:15:30 │ acme   │ admin_01 │ approval.approve │ appr_w55 │ ...    │
│ 14:10:00 │ acme   │ admin_01 │ config.update    │ planner  │ "budget"│
│ 14:05:00 │ acme   │ admin_01 │ session.cancel   │ sess_f01 │ ...    │
└──────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### ApprovalCard

单张审批卡片，显示：

| 字段 | 说明 |
|---|---|
| Requested | 相对时间（"2m ago"） |
| Risk Level | 高/中/低 标签（红/橙/绿） |
| Session / Agent / Tenant | 上下文信息 |
| Action | `action_type` + `tool_name` + `tool_args` 摘要 |
| Side Effect | none/low/medium/high |
| Risk Score | 数值 |
| Review Reason | 触发审批的原因说明 |

### ApprovalContextModal

点击 "View Context" 弹出全屏模态/侧边抽屉，展示 `PendingApprovalContextSnapshot`：

- **Workspace Snapshot**：使用 `WorkspaceSnapshotViewer` 组件（与 Workspace Inspector 共用）
- **所有 Proposals**：当时竞争的所有提案
- **所有 Candidate Actions**：候选行动列表
- **Predictions**：行动预测
- **Policy Decisions**：策略决策
- **Selected Action**：被选中的行动及其详细信息

这是只读视图，帮助审批人理解完整的决策上下文。

### DecisionButtons

- **Approve**：绿色按钮，调用 `POST /v1/approvals/:id/decision` with `{ decision: "approved", approver_id }`
- **Reject**：红色按钮，点击展开评论输入框，提交 `{ decision: "rejected", approver_id, comment }`

### ApprovalHistoryTable

| 列 | 说明 |
|---|---|
| Approval ID | 可点击查看详情 |
| Session | session_id，可点击跳转 |
| Action | action_type + tool_name |
| Decision | approved（绿）/ rejected（红）标签 |
| Approver | approver_id |
| Comment | 评论摘要（hover 展开） |
| Decided At | 时间戳 |

筛选：decision、approver、tenant、date range

### AuditLogTable

审计日志条目。记录所有管理操作：

| Action Type | 说明 |
|---|---|
| `approval.approve` | 审批通过 |
| `approval.reject` | 审批拒绝 |
| `config.update` | 配置变更 |
| `session.cancel` | Session 取消 |
| `session.delete` | Session 删除 |
| `key.create` | API Key 创建 |
| `key.revoke` | API Key 撤销 |

每条显示：timestamp, tenant_id, user_id, action_type, target_id, details（JSON）

## 实时更新

- WS `approvals` 通道推送新审批请求
- 新审批出现时：卡片以 slide-in 动画加入队列
- 审批被处理时（可能是其他用户操作）：卡片从队列 fade-out 移到 History
- Sidebar 上的 Approvals 图标显示 pending 数量徽章，实时更新

## 数据源

| 数据 | API |
|---|---|
| 待处理队列 | `GET /v1/approvals?status=pending` |
| 历史记录 | `GET /v1/approvals` |
| 审批详情 | `GET /v1/approvals/:id` |
| 审批上下文 | `GET /v1/approvals/:id/context` (新增) 或从 session detail 获取 |
| 审批决策 | `POST /v1/approvals/:id/decision` |
| 审计日志 | `GET /v1/audit-logs` (新增) |

## 组件结构

```
ApprovalCenterPage
  ├── Tab: Queue
  │    └── ApprovalQueue
  │         └── ApprovalCard
  │              ├── RiskBadge
  │              ├── ActionSummary
  │              ├── DecisionButtons
  │              └── [click] → ApprovalContextModal
  │                    └── WorkspaceSnapshotViewer (shared)
  ├── Tab: History
  │    ├── FilterBar (decision, approver, tenant, date)
  │    └── ApprovalHistoryTable
  └── Tab: Audit Log
       ├── FilterBar (action type, tenant, user, date)
       └── AuditLogTable
```
