# 配置编辑器（FR-55）

## 页面路由

- `/config` — 配置入口（默认跳转 Agent Profiles）
- `/config/agents/:agentId` — Agent Profile 编辑
- `/config/policies` — 策略模板管理
- `/config/keys` — API Key 管理

## 布局

三标签页共用侧边导航：

```
┌──────────────────────────────────────────────────────────────────────┐
│ Configuration                                                        │
│ [Agent Profiles] [Policy Templates] [API Keys]                      │
├──────────────────────────────────────────────────────────────────────┤
│ (tab content)                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

## Agent Profiles 标签

```
┌──────────────────────────────────────────────────────────────────────┐
│ Select Agent: [planner ▼]          [Form View] [JSON View]          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Basic                                                                │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Name:        [planner                    ]                       │ │
│ │ Version:     [1.0                        ]                       │ │
│ │ Role:        [task planning agent        ]                       │ │
│ │ Domain:      [general                    ]                       │ │
│ │ Mode:        [runtime ▼]                                        │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ Runtime Config                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Max Cycles:       [50       ]                                    │ │
│ │ Max Runtime (ms): [300000   ]                                    │ │
│ │ Cycle Mode:       [standard ▼]                                   │ │
│ │ Checkpoint:       [cycle ▼]                                      │ │
│ │ Auto Approve:     [☐]                                            │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ Budget                                                               │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Cost Budget:      [$1.00    ]                                    │ │
│ │ Cost Per Token:   [$0.00002 ]                                    │ │
│ │ Token Budget:     [50000    ]                                    │ │
│ │ Cycle Limit:      [50       ]                                    │ │
│ │ Tool Call Limit:  [20       ]                                    │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ Memory                                                               │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Working:  [☑] enabled   Episodic: [☑] enabled                  │ │
│ │ Semantic: [☐] enabled   Procedural: [☑] enabled                │ │
│ │ Write Policy: [immediate ▼]  Retrieval Top-K: [5 ]              │ │
│ │ Consolidation: [☑] enabled                                       │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ Tools & Permissions                                                  │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Tool Refs: [search_web] [read_file] [write_file] [+ Add]       │ │
│ │ Blocked:   [delete_file] [exec_cmd] [× remove]                  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ Approval Policy                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Allowed Approvers: [admin_01] [admin_02] [+ Add]                │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ World Model Config                                                   │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Confidence Decay Factor:  [0.95   ]                              │ │
│ │ Decay Interval (ms):      [60000  ]                              │ │
│ │ Prune Threshold:          [0.1    ]                              │ │
│ │ Default Entity TTL (ms):  [300000 ]                              │ │
│ │ Forward Simulation:       [☑] enabled                            │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ Multi-Agent Config                                                   │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Enabled: [☑]                                                     │ │
│ │ Heartbeat Interval (ms): [5000   ]                               │ │
│ │ Delegation Timeout (ms): [30000  ]                               │ │
│ │ Auction Timeout (ms):    [10000  ]                               │ │
│ │ Max Delegation Depth:    [3      ]                               │ │
│ │ Coordination Strategy:   [hierarchical ▼]                        │ │
│ │ Max Capacity:            [5      ]                               │ │
│ │ Auto Accept Delegation:  [☐]                                     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ [Save Changes]  [Reset]  [Export JSON]                               │
└──────────────────────────────────────────────────────────────────────┘
```

### JSON View

Monaco Editor 展示完整 `AgentProfile` JSON：

- 语法高亮
- 实时校验（基于 TypeScript 接口的 JSON Schema）
- 错误标记（行内红色波浪线 + 问题面板）
- 自动补全（枚举值：mode, cycle_mode, write_policy, coordination_strategy 等）
- 格式化（Shift+Alt+F）

### 交互

- **Agent 选择器**：下拉选择已注册的 Agent
- **Form ↔ JSON 切换**：两种编辑模式同步
- **Save**：`PUT /v1/agents/:id/profile`（新增端点）
- **Reset**：丢弃修改，恢复服务器值
- **Export JSON**：下载当前 profile 为 JSON 文件
- **Dirty 检测**：修改后 Save 按钮高亮，离开页面弹出确认

## Policy Templates 标签

```
┌──────────────────────────────────────────────────────────────────────┐
│ Policy Templates                                  [＋ New Template]  │
├──────────────────────────────────────────────────────────────────────┤
│ Name              │ Description           │ Tools       │ Risk      │
│ tool_safety       │ Basic tool gating     │ all         │ medium    │
│ data_protection   │ Protect sensitive data│ read_file   │ high      │
│ dev_sandbox       │ Dev environment rules │ exec,write  │ low       │
│                   │                       │             │           │
│ [Edit] [Delete]   │                       │             │           │
└──────────────────────────────────────────────────────────────────────┘
```

CRUD 列表：
- **Create**：弹出表单（name, description, affected tools, risk levels, rules）
- **Edit**：内联编辑或弹出表单
- **Delete**：确认对话框

数据源：`GET /v1/policies` (新增), `POST /v1/policies`, `PUT /v1/policies/:id`, `DELETE /v1/policies/:id`

## API Keys 标签

```
┌──────────────────────────────────────────────────────────────────────┐
│ API Keys                                       [＋ Create Key]       │
├──────────────────────────────────────────────────────────────────────┤
│ Key ID    │ Tenant  │ Role     │ Created   │ Last Used │ Status    │
│ key_01    │ acme    │ admin    │ 03-28     │ 1h ago    │ [ACTIVE]  │
│ key_02    │ beta    │ operator │ 03-30     │ 5m ago    │ [ACTIVE]  │
│ key_03    │ acme    │ viewer   │ 03-25     │ —         │ [REVOKED] │
│           │         │          │           │           │           │
│ [Revoke]  │         │          │           │           │           │
└──────────────────────────────────────────────────────────────────────┘
```

- **Create Key**：弹出表单（tenant_id, role, expiration）→ 创建后显示一次完整 key
- **Revoke**：确认后调用 `DELETE /v1/api-keys/:id`
- Key 值在列表中始终脱敏显示（`nc_****xxxx`）

数据源：`GET /v1/api-keys` (新增), `POST /v1/api-keys`, `DELETE /v1/api-keys/:id`

## 数据源汇总

| 操作 | API |
|---|---|
| Agent 列表 | `GET /v1/agents` (新增) |
| Profile 读取 | `GET /v1/agents/:id/profile` (新增) |
| Profile 更新 | `PUT /v1/agents/:id/profile` (新增) |
| 策略列表 | `GET /v1/policies` (新增) |
| 策略创建 | `POST /v1/policies` (新增) |
| 策略更新 | `PUT /v1/policies/:id` (新增) |
| 策略删除 | `DELETE /v1/policies/:id` (新增) |
| Key 列表 | `GET /v1/api-keys` (新增) |
| Key 创建 | `POST /v1/api-keys` (新增) |
| Key 撤销 | `DELETE /v1/api-keys/:id` (新增) |
