# Device 面板

## 页面路由

`/devices`

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ Devices                                        [Refresh]             │
├──────────────────────────────────────────────────────────────────────┤
│ Filter: [Type: All ▼] [Status: All ▼] [Modality: All ▼]            │
├──────────────────────────────────────────────────────────────────────┤
│ Sensors                                                              │
│ ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│ │ camera_01        │  │ mic_01           │  │ lidar_01         │    │
│ │ Type: camera     │  │ Type: microphone │  │ Type: lidar      │    │
│ │ Status: [ONLINE] │  │ Status: [ONLINE] │  │ Status: [OFFLINE]│    │
│ │ Health: healthy  │  │ Health: healthy  │  │ Health: unknown  │    │
│ │ Modality: visual │  │ Modality: audio  │  │ Modality: spatial│    │
│ │ Last: 5s ago     │  │ Last: 2s ago     │  │ Last: —          │    │
│ └──────────────────┘  └──────────────────┘  └──────────────────┘    │
│                                                                      │
│ Actuators                                                            │
│ ┌──────────────────┐  ┌──────────────────┐                          │
│ │ speaker_01       │  │ arm_01           │                          │
│ │ Type: speaker    │  │ Type: robotic_arm │                          │
│ │ Status: [READY]  │  │ Status: [BUSY]   │                          │
│ │ Health: healthy  │  │ Health: degraded │                          │
│ │ Commands: 42     │  │ Commands: 18     │                          │
│ └──────────────────┘  └──────────────────┘                          │
├──────────────────────────────────────────────────────────────────────┤
│ Selected: camera_01                                                  │
│ Recent Readings (last 20)                                            │
│ 14:23:01  visual  conf: 0.92  {fps: 30, resolution: "1080p"}       │
│ 14:23:00  visual  conf: 0.91  {fps: 30, resolution: "1080p"}       │
│ 14:22:59  visual  conf: 0.93  {fps: 30, resolution: "1080p"}       │
│                                                                      │
│ [View Reading Chart]                                                 │
│ [Recharts LineChart: x=time, y=confidence]                          │
└──────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### DeviceGrid

按 `device_type` 分两组展示：Sensors 和 Actuators。

### DeviceCard

每张卡片显示：

| 字段 | 说明 |
|---|---|
| device_id | 卡片标题 |
| device_type | sensor / actuator 标签 |
| Status | 在线状态徽章（见下表） |
| Health | 健康状态徽章（见下表） |
| Modality | 模态标签（visual / audio / spatial / ...） |
| Last Reading / Commands | sensor 显示最近读数时间，actuator 显示命令计数 |

**Device Status 颜色**：

| Status | 颜色 |
|---|---|
| `online` / `ready` | 绿 |
| `busy` | 蓝 |
| `offline` | 灰 |
| `error` | 红 |

**Health Status 颜色**：

| Status | 颜色 |
|---|---|
| `healthy` | 绿 |
| `degraded` | 黄 |
| `unreachable` | 橙 |
| `unknown` | 灰 |

### SensorReadingChart

选中 sensor 后显示的时序图：

- **图表类型**：Recharts `<LineChart>`
- **X 轴**：timestamp
- **Y 轴**：confidence 值（0-1）
- **Tooltip**：显示完整 `structured_data`
- **数据量**：最近 50 条读数

### ActuatorCommandLog

选中 actuator 后显示的命令日志：

| 列 | 字段 |
|---|---|
| Time | `duration_ms` 前的触发时间 |
| Type | `command_type` |
| Status | completed / failed / timeout / cancelled |
| Duration | `duration_ms` |
| Error | `error`（如有） |
| Side Effects | `side_effects[]` |

### PerceptionPanel

当设备与 session 关联时，显示感知管道输出：

每条 Percept 显示：
- `percept_id`
- `modality`
- `percept_type`
- `confidence`
- `data`（JSON 树）
- `spatial_ref`（如有空间坐标）

## 数据源

需要新增后端 API：

| 数据 | API |
|---|---|
| Device 列表 | `GET /v1/devices` → `DeviceInfo[]` |
| Sensor 读数 | `GET /v1/devices/:id/readings` → `SensorReading[]` |
| Actuator 命令 | `GET /v1/devices/:id/commands` → `ActuatorResult[]` |

实时更新通过 WS `devices` 通道：
- `sensor.reading` 事件 → 追加到 sensor 读数列表
- `device.registered` / `device.error` → 更新 device 状态
- `actuator.command` / `actuator.result` → 追加命令日志

## 交互

- **筛选**：按 type (sensor/actuator)、status、modality
- **点击卡片**选中 → 下方展示读数/命令详情
- **Reading Chart**：缩放、hover tooltip
- **实时**：sensor 读数自动追加，chart 自动更新
- **设备健康**：异常状态卡片闪烁提醒

## 组件结构

```
DevicePanelPage
  ├── FilterBar (type, status, modality)
  ├── SensorGrid
  │    └── DeviceCard (sensor variant)
  ├── ActuatorGrid
  │    └── DeviceCard (actuator variant)
  ├── SensorReadingsPanel
  │    ├── ReadingList (recent readings)
  │    └── SensorReadingChart (Recharts LineChart)
  ├── ActuatorLogPanel
  │    └── ActuatorCommandLog (table)
  └── PerceptionPanel (when session-linked)
```
