# WebSocket 协议

## 连接建立

端点：`ws[s]://{host}/v1/ws`

认证方式（二选一）：
- Query 参数：`?token=<api_key>`
- Subprotocol header：`Authorization: Bearer <api_key>`

服务端在 `upgrade` 事件中校验 API Key，提取 `tenant_id` 并绑定连接。现有 SSE 端点 (`/v1/sessions/:id/events/stream`) 保持不变。

## 消息信封

双向消息统一格式：

```typescript
interface WsMessage {
  type: "subscribe" | "unsubscribe" | "event" | "ack" | "error" | "ping" | "pong" | "command";
  channel: string;
  payload: unknown;
  message_id: string;
  timestamp: string;
}
```

## 通道定义

### Server → Client

| 通道 | Payload 类型 | 推送频率 | 说明 |
|---|---|---|---|
| `metrics` | `MetricsSnapshot` | 5s | 全局指标快照 |
| `events` | `NeuroCoreEvent` | 实时 | 当前租户全部事件 |
| `session:{session_id}` | `NeuroCoreEvent` | 实时 | 单 session 事件 |
| `approvals` | `ApprovalRequest` | 实时 | 新审批通知 |
| `approvals:{approval_id}` | `ApprovalRequest` | 实时 | 审批状态变更 |
| `evals` | `EvalRunReport` | 完成时 | Eval 运行完成通知 |
| `agents` | `AgentDescriptor` | 实时 | Agent 注册/注销/状态 |
| `devices` | `DeviceInfo` / `SensorReading` | 实时 | 设备状态与读数 |
| `world:{session_id}` | `WorldStateDiff` | 实时 | 世界状态增量 |
| `delegations` | `DelegationRequest` / `DelegationResponse` | 实时 | 委派生命周期 |

### Client → Server

| 通道 | Payload | 说明 |
|---|---|---|
| `commands` | `WsCommand` | 客户端发起的操作命令 |

## 客户端命令

```typescript
type WsCommand =
  | { action: "session.input"; session_id: string; input: UserInput }
  | { action: "session.cancel"; session_id: string }
  | { action: "session.resume"; session_id: string; input?: UserInput }
  | { action: "approval.decide"; approval_id: string; decision: "approved" | "rejected"; approver_id: string; comment?: string }
  | { action: "eval.run"; agent_id: string; cases: EvalCase[] }
  | { action: "config.update"; agent_id: string; profile: Partial<AgentProfile> };
```

服务端校验命令后执行，通过 `ack` 或 `error` 消息回传结果（引用原始 `message_id`）。

## 订阅生命周期

```
1. Client → Server:
   { type: "subscribe", channel: "session:sess_abc", message_id: "sub_1", ... }

2. Server → Client:
   { type: "ack", channel: "session:sess_abc", payload: { subscribed: true }, message_id: "sub_1", ... }

3. Server → Client (持续推送):
   { type: "event", channel: "session:sess_abc", payload: <NeuroCoreEvent>, ... }

4. Client → Server (取消):
   { type: "unsubscribe", channel: "session:sess_abc", ... }
```

## 心跳

- 服务端每 30s 发送 `{ type: "ping" }`
- 客户端须在 10s 内回复 `{ type: "pong" }`
- 连续 3 次无 pong 响应，服务端关闭连接
- 客户端自动重连，指数退避：1s → 2s → 4s → ... → max 30s

## 租户隔离

连接建立时绑定 `tenant_id`，所有推送事件自动过滤至该租户。客户端无法订阅其他租户的 session（除非认证为 super_admin）。

## 错误处理

```typescript
// 服务端错误响应
{
  type: "error",
  channel: "commands",
  payload: { code: "FORBIDDEN", message: "Not allowed to access session of tenant X" },
  message_id: "cmd_123",  // 引用客户端原始 message_id
  timestamp: "2026-04-01T12:00:00Z"
}
```

错误码：`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_ERROR`、`RATE_LIMITED`。

## MetricsSnapshot 结构

```typescript
interface MetricsSnapshot {
  total_sessions_created: number;
  total_cycles_executed: number;
  active_sessions: number;
  total_eval_runs: number;
  error_count: number;
  average_latency_ms: number;
  eval_pass_rate: number;
  uptime_seconds: number;
  version: string;
}
```
