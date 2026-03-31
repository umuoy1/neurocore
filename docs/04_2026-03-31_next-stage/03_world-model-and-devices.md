# B. 世界模型与外部设备接入 — 详细设计

> Milestone 8 · FR-36 ~ FR-43 · Cerebellar 模块深化

## 1. 概述

### 1.1 当前状态

Cerebellar 模块（小脑 / 世界模型）当前完成度 **75%**，已实现：

- `PredictionStore` + `InMemoryPredictionStore`：记录预测与误差
- `PredictionErrorComputer`：对比预测与观测，生成 outcome/duration/cost/side_effect mismatch 误差
- `RuleBasedPredictor`：基于 action_type + side_effect_level + 历史误差率的规则型预测
- Prediction-Observation-Error-Correction 闭环：trace 包含 `prediction_error_refs`，Episode 基于误差填充 `valence` / `lessons`
- MetaController 消费 `predictionErrorRate`，高误差率降低 confidence 并触发 approval

### 1.2 本里程碑目标

将 Cerebellar 从"预测引擎"升级为 **感知-预测-执行** 完整世界模型：

1. **通用设备 SPI** — 定义 Sensor / Actuator 抽象接口，支持任意外部设备（摄像头、麦克风、机械臂、扬声器等）接入
2. **设备注册与发现** — DeviceRegistry 统一管理设备生命周期、能力查询、健康检测
3. **多模态感知管道** — 将原始传感器数据转换为结构化感知（Percept），喂入认知周期
4. **世界状态图** — 维护实体-关系-属性的动态知识图谱，替代当前 `world_state_digest` 的扁平摘要
5. **前向仿真** — 基于世界状态 + 候选动作预测未来状态，增强 Predictor 能力
6. **主动推理** — 引入 Expected Free Energy 最小化，为决策提供信息论框架
7. **多设备协调** — 传感器融合与执行器编排

### 1.3 预期完成度

Cerebellar 模块完成度：**75% → 90%**

### 1.4 与其他方向的关系

本方向是 **Direction A（多 Agent 分布式调度）的前置依赖**：多 Agent 需要共享世界状态，WorldStateGraph 是共享基础。

---

## 2. 需求分解（FR-36 ~ FR-43）

### FR-36: Sensor SPI — 通用感知接口

| 属性 | 值 |
|---|---|
| ID | FR-36 |
| 标题 | Sensor SPI — 通用感知接口 |
| 优先级 | P0 |
| 依赖 | 无 |

**描述**：定义通用的传感器抽象接口，支持摄像头、麦克风、环境传感器（温度、湿度、LiDAR 等）及任意自定义传感器的接入。接口应覆盖设备描述、数据读取、流式订阅三个层面。

**验收标准**：

- `Sensor` 接口定义完成，包含 `descriptor` / `start()` / `stop()` / `read()` / `subscribe()`
- `SensorDescriptor` 支持 `sensor_type` 和 `modality` 的开放字符串扩展
- `SensorReading` 同时支持 `raw_data_ref`（二进制引用）和 `structured_data`（结构化数据）
- 至少一个示例适配器（如 MockCameraSensor）验证接口可行性

---

### FR-37: Actuator SPI — 通用执行接口

| 属性 | 值 |
|---|---|
| ID | FR-37 |
| 标题 | Actuator SPI — 通用执行接口 |
| 优先级 | P0 |
| 依赖 | 无 |

**描述**：定义通用的执行器抽象接口，支持机械臂、扬声器（含语音合成模型对接）、显示器、电机等输出设备。接口覆盖设备描述、命令执行、状态查询三个层面。

**验收标准**：

- `Actuator` 接口定义完成，包含 `descriptor` / `initialize()` / `execute()` / `stop()` / `getStatus()`
- `ActuatorCommand` 支持 `command_type` + `parameters` 的开放式命令结构
- `ActuatorResult` 包含 `status` / `duration_ms` / `error` 用于闭环反馈
- 扬声器适配器需明确语音合成模型的对接点（`parameters` 中可传递 `voice_model_ref`）

---

### FR-38: Device Registry — 设备注册与发现

| 属性 | 值 |
|---|---|
| ID | FR-38 |
| 标题 | Device Registry — 设备注册/发现/能力查询/健康检测 |
| 优先级 | P0 |
| 依赖 | FR-36, FR-37 |

**描述**：统一的设备注册中心，管理所有 Sensor 和 Actuator 的生命周期，支持按类型/模态/能力查询设备，定期健康检测。

**验收标准**：

- 设备注册/注销 API
- 按 `sensor_type` / `actuator_type` / `modality` / `status` 查询
- 能力查询（capabilities 匹配）
- 健康检测回调，设备异常时 emit `device.error` 事件
- 支持运行时热插拔（注册/注销不需重启 runtime）

---

### FR-39: Multi-Modal Perception Pipeline — 多模态感知管道

| 属性 | 值 |
|---|---|
| ID | FR-39 |
| 标题 | Multi-Modal Perception Pipeline |
| 优先级 | P1 |
| 依赖 | FR-36, FR-38 |

**描述**：可组合的感知处理管道，将原始传感器数据经过多级处理器转换为结构化感知（Percept），作为认知周期 Perceive 阶段的输入。

**验收标准**：

- `PerceptionProcessor` SPI 定义完成
- 管道支持多级处理器串联
- 输出 `Percept` 结构化类型，可注入 `WorkspaceSnapshot`
- 多传感器输入可在管道内融合
- 管道处理有超时和错误兜底

---

### FR-40: World State Graph — 世界状态图

| 属性 | 值 |
|---|---|
| ID | FR-40 |
| 标题 | World State Graph — 动态知识图谱 |
| 优先级 | P0 |
| 依赖 | FR-39 |

**描述**：维护实体-关系-属性的动态世界状态图谱，替代当前 `WorldStateDigest` 的扁平摘要。支持增量更新、时间衰减、查询、快照。

**验收标准**：

- `WorldStateGraph` 接口定义完成，包含 entity CRUD、relation CRUD、query
- 实体支持属性和置信度
- 关系支持类型和强度
- 支持时间衰减（TTL / confidence decay）
- 可生成 `WorldStateDigest` 供现有 `WorkspaceSnapshot` 使用
- 内存实现通过基础 CRUD 测试

---

### FR-41: Forward Simulation — 前向仿真

| 属性 | 值 |
|---|---|
| ID | FR-41 |
| 标题 | Forward Simulation — 基于世界状态的前向仿真 |
| 优先级 | P1 |
| 依赖 | FR-40, 现有 Predictor SPI |

**描述**：基于当前世界状态图和候选动作，模拟执行后的世界状态变化。增强现有 Predictor，使预测从"规则推断"升级为"状态推演"。

**验收标准**：

- `ForwardSimulator` 接口定义完成
- 输入：当前 `WorldStateGraph` + `CandidateAction`
- 输出：`SimulationResult`（预测后的世界状态 diff、成功概率、副作用）
- 可作为 `Predictor` SPI 的增强实现接入现有闭环
- 仿真结果可用于 MetaController 决策

---

### FR-42: Active Inference Integration — 主动推理整合

| 属性 | 值 |
|---|---|
| ID | FR-42 |
| 标题 | Active Inference — Expected Free Energy 最小化 |
| 优先级 | P2 |
| 依赖 | FR-40, FR-41 |

**描述**：引入主动推理（Active Inference）框架，将 Expected Free Energy (EFE) 最小化整合到 MetaController 的决策过程中。EFE = Risk + Ambiguity - Novelty。

**验收标准**：

- `ActiveInferenceEvaluator` 接口定义完成
- 能为每个候选动作计算 EFE 分数
- EFE 分数可作为 MetaController 的评分维度之一
- 与现有 `predictionErrorRate` 机制共存

---

### FR-43: Device Coordination — 多设备协调

| 属性 | 值 |
|---|---|
| ID | FR-43 |
| 标题 | Device Coordination — 传感器融合与执行器编排 |
| 优先级 | P2 |
| 依赖 | FR-38, FR-39 |

**描述**：多设备场景下的协调机制：多传感器数据融合（同一实体的多模态观测合并）、多执行器编排（协调多个执行器完成复合动作）。

**验收标准**：

- 传感器融合策略接口定义完成
- 执行器编排策略接口定义完成
- 支持串行/并行两种编排模式
- 融合冲突时有明确的置信度仲裁策略

---

## 3. 架构设计

### 3.1 感知-预测-执行 三层架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cognitive Cycle                                │
│  Perceive → Retrieve → Simulate → Deliberate → Gate → Act → Observe   │
└────┬──────────────────────┬─────────────────────────────────┬──────────┘
     │                      │                                 │
     ▼                      ▼                                 ▼
┌─────────────┐   ┌──────────────────┐              ┌──────────────────┐
│  Perception │   │  World State     │              │  Actuator        │
│  Layer      │   │  Layer           │              │  Layer           │
│             │   │                  │              │                  │
│ ┌─────────┐ │   │ ┌──────────────┐ │              │ ┌──────────────┐ │
│ │Perception│ │   │ │ WorldState   │ │              │ │  Actuator    │ │
│ │Pipeline  │─┼──▶│ │ Graph       │─┼──┐           │ │  Orchestrator│ │
│ └─────────┘ │   │ └──────────────┘ │  │           │ └──────┬───────┘ │
│      ▲      │   │ ┌──────────────┐ │  │           │        │         │
│      │      │   │ │  Forward     │ │  │           │   ┌────┴────┐    │
│ ┌────┴────┐ │   │ │  Simulator   │◀┼──┘           │   ▼        ▼    │
│ │ Sensor  │ │   │ └──────────────┘ │              │ ┌────┐  ┌────┐  │
│ │ Fusion  │ │   │ ┌──────────────┐ │              │ │Act │  │Act │  │
│ └────┬────┘ │   │ │  Active      │ │              │ │ 1  │  │ 2  │  │
│      │      │   │ │  Inference   │ │              │ └────┘  └────┘  │
│ ┌────┴────┐ │   │ └──────────────┘ │              └──────────────────┘
│ │Sensors  │ │   └──────────────────┘
│ │┌──┐┌──┐│ │
│ ││S1││S2││ │
│ │└──┘└──┘│ │
│ └────────┘ │
└─────────────┘

S1, S2 = Sensor instances (camera, microphone, lidar, ...)
Act 1, Act 2 = Actuator instances (robotic arm, speaker, ...)
```

**数据流向**：

1. **Perceive 阶段**：Sensor → SensorReading → PerceptionPipeline → Percept → WorkspaceSnapshot
2. **Simulate 阶段**：WorldStateGraph + CandidateAction → ForwardSimulator → SimulationResult → Prediction
3. **Act 阶段**：MetaDecision → ActuatorOrchestrator → ActuatorCommand → Actuator → ActuatorResult → Observation

### 3.2 Sensor SPI

```typescript
interface SensorDescriptor {
  sensor_id: string;
  sensor_type: string;
  modality: string;
  capabilities: Record<string, unknown>;
  sampling_rate_hz?: number;
  resolution?: Record<string, number>;
  status: "online" | "offline" | "error";
  metadata?: Record<string, unknown>;
}

interface SensorReading {
  sensor_id: string;
  timestamp: string;
  modality: string;
  raw_data_ref?: string;
  structured_data?: Record<string, unknown>;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

interface Sensor {
  descriptor: SensorDescriptor;
  start(): Promise<void>;
  stop(): Promise<void>;
  read(): Promise<SensorReading>;
  subscribe?(callback: (reading: SensorReading) => void): () => void;
}
```

**设计要点**：

| 字段 | 说明 |
|---|---|
| `sensor_type` | 开放字符串，预定义值包括 `"camera"` / `"microphone"` / `"lidar"` / `"temperature"` / `"imu"` / `"gps"`，也可自定义 |
| `modality` | 感知模态：`"visual"` / `"auditory"` / `"tactile"` / `"proprioceptive"` / `"thermal"` 等，开放扩展 |
| `raw_data_ref` | 指向二进制数据的引用（URL / 文件路径 / 对象存储 key），避免在消息中传输大量原始数据 |
| `structured_data` | 已处理的结构化数据（如摄像头的边界框列表、麦克风的 STT 文本），由 PerceptionPipeline 填充 |
| `subscribe()` | 可选方法，支持流式推送场景（如实时视频帧、连续语音流） |

### 3.3 Actuator SPI

```typescript
interface ActuatorDescriptor {
  actuator_id: string;
  actuator_type: string;
  modality: string;
  capabilities: Record<string, unknown>;
  degrees_of_freedom?: number;
  max_force?: number;
  status: "ready" | "busy" | "error" | "offline";
  metadata?: Record<string, unknown>;
}

interface ActuatorCommand {
  command_id: string;
  actuator_id: string;
  command_type: string;
  parameters: Record<string, unknown>;
  timeout_ms?: number;
  priority?: number;
  preconditions?: string[];
  safety_constraints?: Record<string, unknown>;
}

interface ActuatorResult {
  command_id: string;
  actuator_id: string;
  command_type: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  result?: Record<string, unknown>;
  error?: string;
  duration_ms: number;
  side_effects?: string[];
}

interface Actuator {
  descriptor: ActuatorDescriptor;
  initialize(): Promise<void>;
  execute(command: ActuatorCommand): Promise<ActuatorResult>;
  stop(): Promise<void>;
  emergencyStop?(): Promise<void>;
  getStatus(): ActuatorDescriptor["status"];
}
```

**设计要点**：

| 字段 | 说明 |
|---|---|
| `actuator_type` | 开放字符串：`"robotic_arm"` / `"speaker"` / `"display"` / `"motor"` / `"gripper"` 等 |
| `modality` | 输出模态：`"mechanical"` / `"auditory"` / `"visual"` / `"haptic"` 等 |
| `safety_constraints` | 执行安全约束（如机械臂最大速度、最大力矩），由适配器在 `execute()` 内校验 |
| `emergencyStop()` | 可选紧急停止方法，用于机械臂等物理执行器的安全保障 |
| `side_effects` | 执行结果的副作用描述，回写到 `Observation.side_effects` 形成闭环 |

### 3.4 Device Registry

```typescript
type DeviceType = "sensor" | "actuator";

interface DeviceInfo {
  device_id: string;
  device_type: DeviceType;
  descriptor: SensorDescriptor | ActuatorDescriptor;
  registered_at: string;
  last_health_check?: string;
  health_status: "healthy" | "degraded" | "unreachable" | "unknown";
}

interface DeviceQuery {
  device_type?: DeviceType;
  sensor_type?: string;
  actuator_type?: string;
  modality?: string;
  status?: string;
  capability?: string;
}

interface DeviceHealthCallback {
  (device_id: string, status: DeviceInfo["health_status"], error?: string): void;
}

interface DeviceRegistry {
  registerSensor(sensor: Sensor): void;
  registerActuator(actuator: Actuator): void;
  unregister(device_id: string): void;

  getSensor(sensor_id: string): Sensor | undefined;
  getActuator(actuator_id: string): Actuator | undefined;

  query(query: DeviceQuery): DeviceInfo[];
  listAll(): DeviceInfo[];

  startHealthCheck(interval_ms: number): void;
  stopHealthCheck(): void;
  onHealthChange(callback: DeviceHealthCallback): () => void;
}
```

**运行时行为**：

- 设备注册时自动 emit `device.registered` 事件
- 健康检测轮询各设备 status，变化时 emit `device.error` 事件
- 支持热插拔：注册/注销不需重启 runtime，DeviceRegistry 维护活跃设备集合
- 设备查询支持按类型、模态、能力、状态的组合过滤

### 3.5 Perception Pipeline

```typescript
interface Percept {
  percept_id: string;
  source_sensor_ids: string[];
  modality: string;
  percept_type: string;
  timestamp: string;
  data: Record<string, unknown>;
  confidence: number;
  spatial_ref?: { x?: number; y?: number; z?: number; frame?: string };
  metadata?: Record<string, unknown>;
}

interface PerceptionProcessor {
  name: string;
  supported_modalities: string[];
  process(readings: SensorReading[]): Promise<Percept[]>;
}

interface PerceptionPipeline {
  addProcessor(processor: PerceptionProcessor): void;
  removeProcessor(name: string): void;

  ingest(readings: SensorReading[]): Promise<Percept[]>;
  ingestFromSensors(sensor_ids: string[]): Promise<Percept[]>;

  setFusionStrategy?(strategy: SensorFusionStrategy): void;
}
```

**管道处理流程**：

```
SensorReading[] ──► 按 modality 分组 ──► 各 PerceptionProcessor 处理 ──► Percept[]
                                                                           │
                                                           ┌───────────────┘
                                                           ▼
                                                    SensorFusion
                                                    (多模态合并)
                                                           │
                                                           ▼
                                                    Percept[] (融合后)
                                                           │
                                                           ▼
                                                  WorldStateGraph.update()
```

- 每个 `PerceptionProcessor` 负责一种模态的处理（如 `VisualProcessor` 处理摄像头帧，输出物体检测 Percept）
- 处理器可串联：前一个处理器的输出作为后一个的输入
- 管道有全局超时，单个处理器异常不阻塞其他处理器

### 3.6 World State Graph

```typescript
interface WorldEntity {
  entity_id: string;
  entity_type: string;
  properties: Record<string, unknown>;
  confidence: number;
  last_observed: string;
  source_percept_ids?: string[];
  ttl_ms?: number;
}

interface WorldRelation {
  relation_id: string;
  relation_type: string;
  source_entity_id: string;
  target_entity_id: string;
  properties?: Record<string, unknown>;
  strength: number;
  confidence: number;
  last_observed: string;
}

interface WorldStateQuery {
  entity_type?: string;
  relation_type?: string;
  entity_id?: string;
  min_confidence?: number;
  spatial_bounds?: { min_x: number; max_x: number; min_y: number; max_y: number };
  max_age_ms?: number;
}

interface WorldStateDiff {
  added_entities: WorldEntity[];
  updated_entities: { entity_id: string; changes: Record<string, unknown> }[];
  removed_entity_ids: string[];
  added_relations: WorldRelation[];
  removed_relation_ids: string[];
}

interface WorldStateGraph {
  addEntity(entity: WorldEntity): void;
  updateEntity(entity_id: string, properties: Partial<WorldEntity>): void;
  removeEntity(entity_id: string): void;
  getEntity(entity_id: string): WorldEntity | undefined;

  addRelation(relation: WorldRelation): void;
  removeRelation(relation_id: string): void;

  query(query: WorldStateQuery): { entities: WorldEntity[]; relations: WorldRelation[] };

  applyPercepts(percepts: Percept[]): WorldStateDiff;
  applyDiff(diff: WorldStateDiff): void;

  decayConfidence(now: string): void;
  pruneExpired(now: string): number;

  snapshot(): { entities: WorldEntity[]; relations: WorldRelation[] };
  toDigest(): WorldStateDigest;
}
```

**与现有系统的对接**：

- `toDigest()` 输出 `WorldStateDigest`，直接填充 `WorkspaceSnapshot.world_state_digest`
- `applyPercepts()` 接收 PerceptionPipeline 的输出，更新图谱并返回 diff
- `decayConfidence()` 在每个 cycle 开始时调用，对久未观测的实体降低置信度
- `pruneExpired()` 清除已超过 TTL 的实体

### 3.7 Forward Simulation

```typescript
interface SimulationResult {
  simulation_id: string;
  action_id: string;
  predicted_diff: WorldStateDiff;
  success_probability: number;
  risk_score: number;
  side_effects: string[];
  estimated_duration_ms: number;
  confidence: number;
  reasoning?: string;
}

interface ForwardSimulator {
  simulate(
    current_state: WorldStateGraph,
    action: CandidateAction,
    context: ModuleContext
  ): Promise<SimulationResult>;

  simulateMultiple?(
    current_state: WorldStateGraph,
    actions: CandidateAction[],
    context: ModuleContext
  ): Promise<SimulationResult[]>;
}
```

**与 Predictor SPI 的关系**：

ForwardSimulator 作为 Predictor 的增强实现，通过适配器接入现有闭环：

```typescript
interface SimulationBasedPredictor extends Predictor {
  name: string;
  predict(ctx: ModuleContext, action: CandidateAction): Promise<Prediction | null>;
  recordError?(error: PredictionError): Promise<void>;
}
```

`SimulationBasedPredictor.predict()` 内部调用 `ForwardSimulator.simulate()`，将 `SimulationResult` 转换为标准 `Prediction` 类型，无缝接入现有 PredictionStore / PredictionErrorComputer / MetaController 闭环。

### 3.8 Active Inference

**Expected Free Energy (EFE) 公式**：

```
EFE(action) = Risk + Ambiguity - Novelty

Risk      = D_KL[ Q(o|π) || P(o) ]       // 预测结果与偏好目标的偏离
Ambiguity = H[ P(o|s,π) ]                // 预测结果的不确定性
Novelty   = H[ Q(s|π) ] - H[ Q(s|o,π) ]  // 动作带来的信息增益
```

EFE 越低，动作越优。Agent 倾向于选择既能达成目标（低 Risk）、又能降低不确定性（高 Novelty / 低 Ambiguity）的动作。

```typescript
interface FreeEnergyComponents {
  risk: number;
  ambiguity: number;
  novelty: number;
  efe: number;
}

interface ActiveInferenceEvaluator {
  computeEFE(
    current_state: WorldStateGraph,
    action: CandidateAction,
    simulation: SimulationResult,
    goal_preferences: GoalDigest[]
  ): FreeEnergyComponents;
}

interface ActiveInferenceConfig {
  enabled: boolean;
  risk_weight: number;
  ambiguity_weight: number;
  novelty_weight: number;
  efe_threshold?: number;
}
```

**与 MetaController 的整合**：

EFE 分数作为 MetaController 多维评分的新维度，与现有的 salience / confidence / risk / predictionErrorRate 共存：

| 评分维度 | 来源 | 权重 |
|---|---|---|
| salience | WorkspaceCoordinator 竞争广播 | 配置值 |
| confidence | Predictor + 历史误差率 | 配置值 |
| risk | PolicyProvider + Predictor | 配置值 |
| prediction_error_rate | PredictionStore 统计 | 固定（0.3 衰减） |
| **efe** | **ActiveInferenceEvaluator** | **配置值（新增）** |

---

## 4. 设备适配器示例

以下示例展示 SPI 的灵活性，是设计验证而非必须实现。

### 4.1 Camera Adapter（视觉输入 → 物体检测）

```typescript
interface CameraSensorConfig {
  device_path: string;
  width: number;
  height: number;
  fps: number;
  format: "rgb" | "bgr" | "grayscale";
}

// Sensor 实现示例结构
// descriptor.sensor_type = "camera"
// descriptor.modality = "visual"
// descriptor.capabilities = { supports_autofocus: true, max_resolution: { width: 1920, height: 1080 } }
// descriptor.resolution = { width: 1920, height: 1080 }
// descriptor.sampling_rate_hz = 30

// read() → SensorReading
//   raw_data_ref = "buffer://frame-{timestamp}"
//   structured_data = null (由 PerceptionProcessor 处理)

// 对应的 PerceptionProcessor：
// VisualPerceptionProcessor.process(readings) → Percept[]
//   percept_type = "object_detection"
//   data = { objects: [{ label: "cup", bbox: [x,y,w,h], confidence: 0.95 }] }
```

### 4.2 Microphone Adapter（语音输入 → 文本感知）

```typescript
interface MicrophoneSensorConfig {
  device_id: string;
  sample_rate_hz: number;
  channels: number;
  encoding: "pcm_s16le" | "pcm_f32le";
  vad_enabled?: boolean;
}

// descriptor.sensor_type = "microphone"
// descriptor.modality = "auditory"
// descriptor.capabilities = { noise_cancellation: true, vad: true }
// descriptor.sampling_rate_hz = 16000

// subscribe(callback) → 流式推送音频帧
// read() → SensorReading
//   raw_data_ref = "buffer://audio-{timestamp}"

// 对应的 PerceptionProcessor：
// AuditoryPerceptionProcessor.process(readings) → Percept[]
//   percept_type = "speech_transcript"
//   data = { text: "请把杯子递给我", language: "zh-CN", confidence: 0.92 }
//
//   percept_type = "sound_event"
//   data = { event: "door_knock", confidence: 0.78 }
```

### 4.3 Speaker Adapter（文本 → 语音合成 → 音频输出）

```typescript
interface SpeakerActuatorConfig {
  device_id: string;
  sample_rate_hz: number;
  channels: number;
  voice_model_ref?: string;
}

// descriptor.actuator_type = "speaker"
// descriptor.modality = "auditory"
// descriptor.capabilities = {
//   supported_languages: ["zh-CN", "en-US"],
//   voice_models: ["default", "expressive-v2"],
//   max_text_length: 4096
// }

// execute(command) 的命令结构：
// command.command_type = "speak"
// command.parameters = {
//   text: "好的，我这就把杯子递给你",
//   language: "zh-CN",
//   voice_model_ref: "expressive-v2",  // 可选：指定语音合成模型
//   speed: 1.0,
//   pitch: 1.0,
//   volume: 0.8
// }
//
// 适配器内部流程：
// 1. 调用 voice synthesis model 将文本转换为音频
// 2. 将音频数据发送到物理扬声器设备
// 3. 返回 ActuatorResult { status: "completed", duration_ms: 2340 }
```

**关键设计**：语音合成模型是扬声器适配器的内部依赖，通过 `voice_model_ref` 参数选择。Actuator SPI 不关心合成细节——适配器实现自行管理 TTS 模型的加载和调用。

### 4.4 Robotic Arm Adapter（运动命令 → 位置反馈）

```typescript
interface RoboticArmConfig {
  controller_endpoint: string;
  arm_id: string;
  degrees_of_freedom: number;
  coordinate_frame: "base" | "world" | "tool";
}

// descriptor.actuator_type = "robotic_arm"
// descriptor.modality = "mechanical"
// descriptor.capabilities = {
//   max_payload_kg: 5.0,
//   reach_mm: 850,
//   repeatability_mm: 0.05,
//   supported_commands: ["move_to", "grip", "release", "home"]
// }
// descriptor.degrees_of_freedom = 6

// execute(command) 命令示例：
// command.command_type = "move_to"
// command.parameters = {
//   target_position: { x: 0.3, y: -0.1, z: 0.2 },
//   orientation: { roll: 0, pitch: Math.PI, yaw: 0 },
//   velocity: 0.5,
//   acceleration: 0.3
// }
// command.safety_constraints = {
//   max_velocity: 1.0,
//   max_force_n: 50,
//   collision_detection: true
// }
//
// → ActuatorResult {
//     status: "completed",
//     result: { final_position: { x: 0.3, y: -0.1, z: 0.2 }, joint_angles: [...] },
//     duration_ms: 1200
//   }

// emergencyStop() → 立即停止所有运动，锁定当前位置
```

---

## 5. 与现有模块的交互

### 5.1 Predictor SPI 增强

现有 `Predictor` 接口保持不变，新增 `SimulationBasedPredictor` 作为 `ForwardSimulator` 的适配器实现：

```typescript
// 现有接口不变
interface Predictor {
  name: string;
  predict(ctx: ModuleContext, action: CandidateAction): Promise<Prediction | null>;
  recordError?(error: PredictionError): Promise<void>;
}
```

`RuleBasedPredictor`（现有）和 `SimulationBasedPredictor`（新增）通过 `AgentProfile.prediction_config.predictor_order` 配置优先级，在 CycleEngine 中按顺序调用。

### 5.2 WorkspaceSnapshot.world_state_digest

现有 `WorkspaceSnapshot` 已预留 `world_state_digest?: WorldStateDigest` 字段。本方向的改动：

- `WorldStateGraph.toDigest()` 在每个 cycle 的 Perceive 阶段后调用
- 输出的 `WorldStateDigest` 自动填充到 `WorkspaceSnapshot`
- 下游模块（Reasoner / MetaController）通过 `workspace.world_state_digest` 获取世界状态摘要

### 5.3 CandidateAction preconditions

`CandidateAction.preconditions` 现在可以引用 WorldStateGraph 中的实体状态：

```
preconditions: ["entity:cup_01:reachable=true", "entity:arm_01:status=ready"]
```

ForwardSimulator 在仿真前校验 preconditions 是否满足，不满足时 `SimulationResult.success_probability` 降为 0。

### 5.4 Memory 系统

设备交互产生的 Episode 记录设备上下文：

- `Episode.context_digest` 包含 WorldStateGraph 快照摘要
- `Episode.action_refs` 包含 ActuatorCommand 引用
- `Episode.observation_refs` 包含传感器观测引用
- 跨 session 的 episodic recall 可以检索到包含特定设备交互的历史 episode

### 5.5 认知周期阶段映射

| 认知阶段 | 新增交互 |
|---|---|
| Perceive | PerceptionPipeline.ingestFromSensors() → Percept[] → WorldStateGraph.applyPercepts() |
| Retrieve | 不变（但 memory recall 可检索包含设备交互的 episodes） |
| Simulate | ForwardSimulator.simulate() 替代/增强 RuleBasedPredictor |
| Deliberate | ActiveInferenceEvaluator.computeEFE() 提供新评分维度 |
| Gate | 不变（MetaController 消费 EFE 分数） |
| Act | ActuatorOrchestrator 编排 → Actuator.execute() |
| Observe | ActuatorResult → Observation；SensorReading → 下一 cycle 的 Perceive |
| Learn | Episode 记录设备上下文；PredictionErrorComputer 对比 SimulationResult 与实际 |

---

## 6. 新增事件

| 事件类型 | 触发时机 | Payload 类型 |
|---|---|---|
| `sensor.reading` | Sensor.read() 或 subscribe 回调后 | `SensorReading` |
| `actuator.command` | Actuator.execute() 调用前 | `ActuatorCommand` |
| `actuator.result` | Actuator.execute() 返回后 | `ActuatorResult` |
| `world_state.updated` | WorldStateGraph.applyPercepts() 或 applyDiff() 后 | `WorldStateDiff` |
| `simulation.completed` | ForwardSimulator.simulate() 返回后 | `SimulationResult` |
| `device.registered` | DeviceRegistry.registerSensor/Actuator() 后 | `DeviceInfo` |
| `device.error` | 健康检测发现设备异常 | `{ device_id: string; error: string; previous_status: string }` |

这些事件类型需添加到 `NeuroCoreEventType` 联合类型中，并在 `EventEnvelope` 中注册对应 payload 类型。

---

## 7. 包结构

### 7.1 新增包

| 包名 | 职责 |
|---|---|
| `@neurocore/device-core` | Sensor SPI、Actuator SPI、DeviceRegistry 接口、Percept 类型 |
| `@neurocore/world-model` | WorldStateGraph、ForwardSimulator、ActiveInferenceEvaluator、PerceptionPipeline |

### 7.2 包依赖关系

```
@neurocore/protocol
    ▲
    │
@neurocore/device-core ◄─── @neurocore/world-model
    ▲                            ▲
    │                            │
@neurocore/runtime-core ─────────┘
```

- `device-core` 依赖 `protocol`（使用 `Timestamp` 等基础类型）
- `world-model` 依赖 `device-core`（使用 Sensor/Actuator/Percept 类型）和 `protocol`（使用 Prediction/ModuleContext 等）
- `runtime-core` 依赖两者，在 CycleEngine 中集成感知-预测-执行流程

### 7.3 现有包改动

| 包 | 改动 |
|---|---|
| `protocol` | 新增事件类型到 `NeuroCoreEventType`；`WorldStateDigest` 类型已存在无需改动 |
| `runtime-core` | CycleEngine Perceive/Simulate/Act 阶段接入新模块；AgentRuntime 接受 DeviceRegistry/WorldStateGraph 注入 |
| `runtime-server` | 新增设备管理 API（`GET/POST /v1/devices`），可选 |

---

## 8. 验收标准

### Milestone 8 整体验收

| # | 验收条件 | 对应 FR |
|---|---|---|
| 1 | Sensor SPI 定义完成，MockCameraSensor 通过 read/subscribe 测试 | FR-36 |
| 2 | Actuator SPI 定义完成，MockRoboticArm 通过 execute/emergencyStop 测试 | FR-37 |
| 3 | DeviceRegistry 支持注册/注销/查询/健康检测，热插拔不需重启 | FR-38 |
| 4 | PerceptionPipeline 能将 SensorReading 转换为 Percept，多处理器串联 | FR-39 |
| 5 | WorldStateGraph 支持 entity/relation CRUD、query、confidence decay、TTL prune | FR-40 |
| 6 | WorldStateGraph.toDigest() 输出可填充 WorkspaceSnapshot.world_state_digest | FR-40 |
| 7 | ForwardSimulator 能基于 WorldStateGraph + CandidateAction 输出 SimulationResult | FR-41 |
| 8 | SimulationBasedPredictor 可作为 Predictor 接入现有闭环 | FR-41 |
| 9 | ActiveInferenceEvaluator 能为候选动作计算 EFE 分数 | FR-42 |
| 10 | SensorFusionStrategy 能合并多传感器对同一实体的观测 | FR-43 |
| 11 | ActuatorOrchestrator 能编排多执行器的串行/并行执行 | FR-43 |
| 12 | 所有新增事件类型已注册且在正确时机 emit | 全部 |
| 13 | 现有 132 个测试不被破坏（回归通过） | 全部 |

### 完成度指标

- Cerebellar 完成度从 75% 提升至 90%
- 新增测试覆盖全部 SPI 的基础 CRUD 和闭环场景
- 文档同步更新：`01_mvp-gaps-and-next-steps.md` 和 `02_gap-analysis-and-roadmap.md` 反映新完成度

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 设备 SPI 设计过于通用导致实现困难 | 适配器开发成本高 | 先用 Mock 适配器验证 SPI 可行性，再迭代调整接口 |
| 实时传感器数据量大导致性能瓶颈 | 认知周期变慢 | `raw_data_ref` 引用机制避免内存拷贝；PerceptionPipeline 有超时保护 |
| WorldStateGraph 内存占用随实体增长 | 长时运行 OOM | TTL + confidence decay + pruneExpired() 定期清理 |
| 前向仿真准确度低导致误导决策 | MetaController 做出错误选择 | SimulationBasedPredictor 仍经过 PredictionErrorComputer 校验，高误差率时自动降权 |
| 物理执行器的安全风险 | 机械臂碰撞等事故 | `safety_constraints` + `emergencyStop()` + Actuator.execute() 内部校验 |
| Active Inference 参数调优困难 | EFE 分数不可解释 | 提供 `FreeEnergyComponents` 细分字段，支持单独调节 risk/ambiguity/novelty 权重 |
| 新包增多导致构建复杂度上升 | CI 变慢 | 新包遵循现有 monorepo 约定（tsc -b），增量编译不影响全局 |
| 多设备协调的时序问题 | 传感器数据与执行器命令时间不同步 | `SensorReading.timestamp` 和 `ActuatorCommand` 统一使用 ISO 8601 时间戳，融合策略按时间窗口对齐 |