# M8: 世界模型与设备接入 — 技术架构设计

> 基于 `03_world-model-and-devices.md` 的 SPI 详细设计，本文档描述实现层面的模块拆分、
> 类结构、依赖注入、数据流时序、错误处理和测试策略。

---

## 1. 包拆分与内部模块结构

### 1.1 `@neurocore/device-core`

```
packages/device-core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # 公共导出
    ├── types.ts                    # SensorDescriptor / ActuatorDescriptor / Percept / DeviceQuery 等
    ├── sensor/
    │   ├── sensor.ts               # Sensor 接口
    │   └── mock-camera-sensor.ts   # MockCameraSensor（验证用）
    ├── actuator/
    │   ├── actuator.ts             # Actuator 接口
    │   └── mock-speaker-actuator.ts # MockSpeakerActuator（验证用）
    ├── registry/
    │   ├── device-registry.ts      # DeviceRegistry 接口
    │   ├── in-memory-device-registry.ts
    │   └── health-checker.ts       # 健康检测定时器逻辑
    ├── perception/
    │   ├── perception-processor.ts # PerceptionProcessor SPI
    │   ├── perception-pipeline.ts  # PerceptionPipeline 接口
    │   └── default-perception-pipeline.ts
    └── fusion/
        ├── sensor-fusion-strategy.ts   # SensorFusionStrategy 接口
        ├── actuator-orchestrator.ts    # ActuatorOrchestrator 接口
        ├── default-sensor-fusion.ts    # LatestValueFusion（默认实现）
        └── default-actuator-orchestrator.ts
```

### 1.2 `@neurocore/world-model`

```
packages/world-model/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts                    # WorldEntity / WorldRelation / WorldStateDiff / WorldStateQuery
    ├── graph/
    │   ├── world-state-graph.ts    # WorldStateGraph 接口
    │   └── in-memory-world-state-graph.ts
    ├── simulation/
    │   ├── forward-simulator.ts    # ForwardSimulator SPI
    │   ├── rule-based-simulator.ts # 默认规则型仿真实现
    │   └── simulation-based-predictor.ts  # Predictor 适配器
    └── inference/
        ├── active-inference-evaluator.ts  # ActiveInferenceEvaluator 接口
        ├── free-energy-components.ts      # FreeEnergyComponents 类型
        └── default-active-inference.ts    # 默认 EFE 计算实现
```

### 1.3 包依赖关系

```
@neurocore/protocol          （零依赖，纯类型 + 事件定义）
     ▲
     │
@neurocore/device-core       （依赖 protocol：Timestamp, SideEffectLevel 等基础类型）
     ▲
     │
@neurocore/world-model       （依赖 device-core：Percept, SensorReading 等）
     ▲                       （依赖 protocol：Prediction, ModuleContext, CandidateAction 等）
     │
@neurocore/runtime-core      （依赖 world-model + device-core）
     │                       （CycleEngine / AgentRuntime 集成）
     ▼
@neurocore/runtime-server    （新增设备管理 API 路由，可选）
```

关键约束：
- `device-core` 和 `world-model` 不依赖 `runtime-core`，保持单向依赖
- `protocol` 不感知 M8 新增类型，M8 类型定义在各自包内
- 事件类型扩展通过 `NeuroCoreEventType` 联合类型追加

---

## 2. 核心类设计

### 2.1 InMemoryDeviceRegistry

```
InMemoryDeviceRegistry
├── sensors: Map<string, { sensor: Sensor; info: DeviceInfo }>
├── actuators: Map<string, { actuator: Actuator; info: DeviceInfo }>
├── healthCheckTimer: NodeJS.Timeout | null
├── healthCallbacks: Set<DeviceHealthCallback>
├── eventBus: EventBus (注入)
│
├── registerSensor(sensor)
│   └── 校验 sensor_id 唯一 → 存入 Map → emit device.registered
├── registerActuator(actuator)
│   └── 校验 actuator_id 唯一 → 存入 Map → emit device.registered
├── unregister(device_id)
│   └── 从 Map 移除 → emit device.deregistered (通过事件总线)
├── query(query)
│   └── 遍历 Map → 按 device_type/sensor_type/actuator_type/modality/status 过滤
├── startHealthCheck(interval_ms)
│   └── setInterval → 遍历所有设备 → 调用 sensor.read() / actuator.getStatus()
│       → 状态变化时 emit device.error + 触发 healthCallbacks
└── stopHealthCheck()
    └── clearInterval
```

健康检测策略：
- Sensor：调用 `read()` 并设置 3s 超时，超时或异常标记 `degraded`
- Actuator：调用 `getStatus()`，返回 `error` / `offline` 标记对应状态
- 连续 3 次异常从 `degraded` 升级为 `unreachable`

### 2.2 DefaultPerceptionPipeline

```
DefaultPerceptionPipeline
├── processors: PerceptionProcessor[]  (有序列表)
├── fusionStrategy?: SensorFusionStrategy
├── timeoutMs: number (默认 5000)
│
├── addProcessor(processor)
│   └── 追加到 processors 列表
├── removeProcessor(name)
│   └── 按 name 查找移除
├── ingest(readings: SensorReading[])
│   └── 1. 按 modality 分组
│       2. 对每组并行调用匹配的 processor.process()
│       3. 单个 processor 异常不阻塞其他（catch + 记录错误）
│       4. 全局 Promise.race 超时保护
│       5. 如果设置了 fusionStrategy，对多源 Percept 执行融合
│       6. 返回 Percept[]
├── ingestFromSensors(sensor_ids: string[])
│   └── 从 DeviceRegistry 获取 Sensor → 并行 read() → 调用 ingest()
└── setFusionStrategy(strategy)
```

### 2.3 InMemoryWorldStateGraph

```
InMemoryWorldStateGraph
├── entities: Map<string, WorldEntity>
├── relations: Map<string, WorldRelation>
├── entityIndex: Map<string, Set<string>>   (entity_type → entity_ids 索引)
├── relationIndex: Map<string, Set<string>> (relation_type → relation_ids 索引)
│
├── addEntity(entity)
│   └── 存入 Map → 更新索引
├── updateEntity(entity_id, properties)
│   └── 合并 properties + 更新 last_observed
├── removeEntity(entity_id)
│   └── 删除实体 + 删除关联 relations + 更新索引
├── getEntity(entity_id)
├── addRelation(relation)
├── removeRelation(relation_id)
├── query(query)
│   └── 1. entity_type 过滤（通过 entityIndex 加速）
│       2. min_confidence 过滤
│       3. max_age_ms 过滤（now - last_observed）
│       4. spatial_bounds 过滤（如果 entity 有 spatial_ref）
│       5. 收集关联 relations
│       6. 返回 { entities, relations }
├── applyPercepts(percepts)
│   └── 1. 遍历 percepts
│       2. 匹配已有 entity（按 percept_type + spatial_ref 关联）
│       3. 匹配成功 → updateEntity（更新属性 + 置信度 + last_observed）
│       4. 匹配失败 → addEntity（新建实体）
│       5. 生成 WorldStateDiff 返回
├── decayConfidence(now)
│   └── 遍历实体 → confidence *= decay_factor ^ (elapsed_ms / decay_interval)
├── pruneExpired(now)
│   └── 遍历实体 → ttl_ms 到期或 confidence < prune_threshold → removeEntity
├── snapshot()
│   └── 深拷贝 { entities, relations }
└── toDigest()
    └── 生成 WorldStateDigest { summary, uncertainty }
        summary = 聚合实体类型统计 + 高置信度实体列表
        uncertainty = 平均 (1 - confidence)
```

### 2.4 SimulationBasedPredictor

```
SimulationBasedPredictor implements Predictor
├── simulator: ForwardSimulator (注入)
├── worldStateGraph: WorldStateGraph (注入)
│
├── predict(ctx, action)
│   └── 1. simulator.simulate(worldStateGraph, action, ctx)
│       2. 将 SimulationResult 转换为 Prediction:
│          - success_probability → Prediction.success_probability
│          - risk_score → Prediction.uncertainty
│          - predicted_diff → Prediction.expected_outcome (序列化)
│          - side_effects → Prediction.side_effects
│          - estimated_duration_ms → Prediction.estimated_duration_ms
│       3. 返回 Prediction
└── recordError(error)
    └── 可选：反馈给 ForwardSimulator 优化仿真模型
```

---

## 3. 数据流时序

### 3.1 Perceive 阶段（传感器 → 世界状态更新）

```
CycleEngine.executeCycle()
  │
  ├── [Phase: Perceive]
  │   │
  │   ├── DeviceRegistry.query({ device_type: "sensor", status: "online" })
  │   │   └── 返回活跃 Sensor 列表
  │   │
  │   ├── PerceptionPipeline.ingestFromSensors(sensor_ids)
  │   │   │
  │   │   ├── 并行: sensor.read() × N
  │   │   │   └── 返回 SensorReading[]
  │   │   │       emit sensor.reading (每个 reading)
  │   │   │
  │   │   ├── 按 modality 分组 readings
  │   │   │
  │   │   ├── 并行: processor.process(grouped_readings)
  │   │   │   └── 返回 Percept[] (每组)
  │   │   │
  │   │   └── fusionStrategy.fuse(all_percepts) (可选)
  │   │       └── 返回 Percept[] (融合后)
  │   │
  │   ├── WorldStateGraph.decayConfidence(now)
  │   │
  │   ├── WorldStateGraph.pruneExpired(now)
  │   │
  │   ├── WorldStateGraph.applyPercepts(percepts)
  │   │   └── 返回 WorldStateDiff
  │   │       emit world_state.updated
  │   │
  │   └── WorldStateGraph.toDigest()
  │       └── 填充 WorkspaceSnapshot.world_state_digest
  │
  ├── [Phase: Retrieve] (不变)
  │
  ├── [Phase: Simulate]
  │   │
  │   ├── 对每个 CandidateAction:
  │   │   ├── RuleBasedPredictor.predict(ctx, action)       (现有)
  │   │   └── SimulationBasedPredictor.predict(ctx, action) (新增)
  │   │       └── ForwardSimulator.simulate(worldStateGraph, action, ctx)
  │   │           emit simulation.completed
  │   │           └── 返回 SimulationResult → 转换为 Prediction
  │   │
  │   └── (可选) ActiveInferenceEvaluator.computeEFE(...)
  │       └── FreeEnergyComponents 注入 MetaController 评分
  ...
```

### 3.2 Act 阶段（执行器编排）

```
CycleEngine.executeCycle()
  │
  ├── [Phase: Act]
  │   │
  │   ├── MetaDecision.selected_action.action_type === "call_tool"
  │   │   且 action 涉及物理执行器
  │   │
  │   ├── ActuatorOrchestrator.execute(commands)
  │   │   │
  │   │   ├── 解析编排模式 (串行 / 并行)
  │   │   │
  │   │   ├── [串行模式]
  │   │   │   ├── for (cmd of commands):
  │   │   │   │   ├── emit actuator.command
  │   │   │   │   ├── actuator.execute(cmd)
  │   │   │   │   │   └── 返回 ActuatorResult
  │   │   │   │   │       emit actuator.result
  │   │   │   │   └── 如果 status === "failed" → 中止后续 / 触发回退
  │   │   │
  │   │   ├── [并行模式]
  │   │   │   ├── Promise.allSettled(commands.map(cmd => actuator.execute(cmd)))
  │   │   │   └── 聚合结果
  │   │   │
  │   │   └── 返回聚合 ActuatorResult[]
  │   │
  │   └── 将 ActuatorResult 转换为 Observation 写入 Cycle
  │       └── Observation.side_effects = result.side_effects
  │           Observation.structured_payload = result.result
```

---

## 4. 与现有模块的集成方式

### 4.1 AgentRuntime 注入点

```typescript
// AgentRuntime 构造参数扩展（可选注入）
interface AgentRuntimeOptions {
  // ... 现有选项 ...
  deviceRegistry?: DeviceRegistry;
  worldStateGraph?: WorldStateGraph;
  perceptionPipeline?: PerceptionPipeline;
  forwardSimulator?: ForwardSimulator;
  activeInferenceEvaluator?: ActiveInferenceEvaluator;
  actuatorOrchestrator?: ActuatorOrchestrator;
}
```

向后兼容策略：
- 所有新注入项为可选（`?`）
- 未注入时，CycleEngine 跳过 Perceive/Simulate 中的新逻辑
- `WorldStateGraph.toDigest()` 未注入时，`world_state_digest` 保持 `undefined`（与现有行为一致）
- `SimulationBasedPredictor` 仅在 `forwardSimulator` 注入时自动注册到 Predictor 列表

### 4.2 CycleEngine 改动范围

```
CycleEngine 改动点:
│
├── executeCycle() 开头新增:
│   ├── if (perceptionPipeline && deviceRegistry)
│   │   └── 执行 Perceive 阶段扩展
│   │
│   ├── if (worldStateGraph)
│   │   └── decayConfidence → pruneExpired → toDigest → 填充 workspace
│   │
│   └── 不改动现有 Retrieve/Propose/Evaluate/Decide 逻辑
│
├── predict 阶段:
│   └── predictors 列表由 AgentRuntime 组装
│       SimulationBasedPredictor 追加到列表尾部（不影响 RuleBasedPredictor 调用）
│
├── meta-decision 阶段:
│   └── if (activeInferenceEvaluator)
│       └── EFE 分数作为额外参数传入 MetaController.evaluate()
│
└── act 阶段:
    └── if (action 涉及执行器 && actuatorOrchestrator)
        └── 走 ActuatorOrchestrator 编排路径
```

### 4.3 事件注册

在 `protocol/src/events.ts` 中扩展 `NeuroCoreEventType`：

```typescript
export type NeuroCoreEventType =
  // ... 现有 18 种 ...
  | "sensor.reading"
  | "actuator.command"
  | "actuator.result"
  | "world_state.updated"
  | "simulation.completed"
  | "device.registered"
  | "device.error";
```

---

## 5. 配置设计

### 5.1 AgentProfile 扩展

```typescript
interface AgentProfile {
  // ... 现有字段 ...
  device_config?: DeviceConfig;
  world_model_config?: WorldModelConfig;
}

interface DeviceConfig {
  health_check_interval_ms?: number;        // 默认 10000
  perception_timeout_ms?: number;           // 默认 5000
  auto_perceive?: boolean;                  // 默认 true（每 cycle 自动感知）
}

interface WorldModelConfig {
  confidence_decay_factor?: number;         // 默认 0.95
  confidence_decay_interval_ms?: number;    // 默认 60000
  prune_confidence_threshold?: number;      // 默认 0.1
  default_entity_ttl_ms?: number;           // 默认 300000 (5min)
  forward_simulation_enabled?: boolean;     // 默认 true
  active_inference_enabled?: boolean;       // 默认 false (P2)
  active_inference_config?: {
    risk_weight: number;                    // 默认 1.0
    ambiguity_weight: number;               // 默认 0.5
    novelty_weight: number;                 // 默认 0.3
    efe_threshold?: number;
  };
}
```

### 5.2 配置向后兼容

- `device_config` 和 `world_model_config` 均为可选字段
- 未配置时所有 M8 功能不激活，行为与当前完全一致
- 配置项使用默认值兜底，无需用户指定每个字段

---

## 6. 错误处理策略

### 6.1 传感器错误

| 场景 | 处理方式 |
|---|---|
| `sensor.read()` 超时 | 跳过该传感器本 cycle 的读取，标记 `degraded`，不阻塞其他传感器 |
| `sensor.read()` 抛出异常 | 同上，额外 emit `device.error` |
| 所有传感器失败 | Perceive 阶段返回空 Percept[]，不影响后续 cycle 阶段 |
| 传感器连续 3 次失败 | 标记 `unreachable`，健康检测回调通知 |

### 6.2 执行器错误

| 场景 | 处理方式 |
|---|---|
| `actuator.execute()` 超时 | 返回 `ActuatorResult { status: "timeout" }`，由 Observation 记录 |
| `actuator.execute()` 抛出异常 | 调用 `emergencyStop()`（如果可用），返回 `{ status: "failed" }` |
| 串行编排中间步骤失败 | 中止后续步骤，返回已完成步骤的结果 + 失败信息 |
| 并行编排部分失败 | 返回所有结果（包含失败的），由上层判断整体结果 |

### 6.3 世界模型错误

| 场景 | 处理方式 |
|---|---|
| `applyPercepts()` 实体匹配冲突 | 按 confidence 优先级保留高置信度版本 |
| `decayConfidence()` 耗时过长 | 限制单次衰减遍历最大实体数（默认 10000） |
| `ForwardSimulator.simulate()` 超时 | 返回 null，CycleEngine 回退到 RuleBasedPredictor 结果 |
| 仿真结果与实际偏差大 | 通过 PredictionErrorComputer 自动记录，高误差率时 MetaController 降低仿真权重 |

---

## 7. 实现顺序

按依赖关系从底层向上推进：

```
Phase 1 (M8.1 + M8.2): Sensor SPI + Actuator SPI
  ├── 定义类型和接口
  ├── 实现 MockCameraSensor + MockSpeakerActuator
  └── 单元测试

Phase 2 (M8.3): DeviceRegistry
  ├── 依赖 Phase 1 的 Sensor/Actuator 接口
  ├── 实现 InMemoryDeviceRegistry + HealthChecker
  └── 单元测试: CRUD + 查询 + 健康检测 + 事件

Phase 3 (M8.4): PerceptionPipeline
  ├── 依赖 Phase 1 的 SensorReading + Phase 2 的 DeviceRegistry
  ├── 实现 DefaultPerceptionPipeline
  └── 单元测试: 多处理器串联 + 超时 + 错误隔离

Phase 4 (M8.5): WorldStateGraph
  ├── 依赖 Phase 3 的 Percept 类型
  ├── 实现 InMemoryWorldStateGraph
  └── 单元测试: CRUD + query + decay + prune + toDigest

Phase 5 (M8.6): ForwardSimulator + SimulationBasedPredictor
  ├── 依赖 Phase 4 的 WorldStateGraph
  ├── 实现 RuleBasedSimulator + SimulationBasedPredictor
  └── 单元测试: simulate → Prediction 转换 + Predictor 闭环

Phase 6 (M8.7): Active Inference (P2)
  ├── 依赖 Phase 4 + Phase 5
  ├── 实现 DefaultActiveInferenceEvaluator
  └── 单元测试: EFE 计算

Phase 7 (M8.8): Device Coordination (P2)
  ├── 依赖 Phase 2 + Phase 3
  ├── 实现 DefaultSensorFusion + DefaultActuatorOrchestrator
  └── 单元测试: 融合 + 编排

Phase 8 (M8.9): 集成与回归
  ├── CycleEngine 集成
  ├── AgentRuntime 注入
  ├── 事件注册
  └── 全量回归测试
```

---

## 8. 测试策略

### 8.1 单元测试

| 模块 | 测试文件 | 关键场景 |
|---|---|---|
| MockCameraSensor | `sensor.test.ts` | start/stop/read/subscribe 生命周期；read 返回正确 SensorReading 结构 |
| MockSpeakerActuator | `actuator.test.ts` | initialize/execute/stop/emergencyStop/getStatus；execute 超时处理 |
| InMemoryDeviceRegistry | `device-registry.test.ts` | 注册/注销/查询/热插拔；健康检测回调；重复注册报错 |
| DefaultPerceptionPipeline | `perception-pipeline.test.ts` | 单处理器/多处理器串联；modality 分组；超时保护；单处理器错误不阻塞 |
| InMemoryWorldStateGraph | `world-state-graph.test.ts` | entity CRUD；relation CRUD；query 多条件组合；applyPercepts 新建/更新；decayConfidence 衰减验证；pruneExpired TTL 清除；toDigest 输出格式 |
| RuleBasedSimulator | `forward-simulator.test.ts` | simulate 返回 SimulationResult；precondition 不满足时 success_probability=0 |
| SimulationBasedPredictor | `simulation-predictor.test.ts` | SimulationResult → Prediction 转换正确；recordError 传递 |
| DefaultActiveInferenceEvaluator | `active-inference.test.ts` | EFE = risk + ambiguity - novelty 公式验证；权重配置生效 |
| DefaultSensorFusion | `sensor-fusion.test.ts` | 多源同实体合并；冲突置信度仲裁 |
| DefaultActuatorOrchestrator | `actuator-orchestrator.test.ts` | 串行编排顺序执行；并行编排并发执行；中间步骤失败处理 |

### 8.2 集成测试

| 场景 | 验证点 |
|---|---|
| 感知闭环 | Sensor.read → Pipeline.ingest → WorldStateGraph.applyPercepts → toDigest → WorkspaceSnapshot |
| 仿真闭环 | WorldStateGraph + CandidateAction → ForwardSimulator → SimulationBasedPredictor → Prediction → MetaController |
| 执行闭环 | MetaDecision → ActuatorOrchestrator → Actuator.execute → ActuatorResult → Observation |
| 完整 Cycle | Perceive → Simulate → Decide → Act → Observe → Learn（含设备交互） |

### 8.3 回归测试

- 不注入 M8 组件时，现有 132+ 测试全部通过
- `tsc --noEmit` 通过
- 新包构建通过

---

## 9. 关键设计决策

### 9.1 为什么拆分为两个包而非一个

| 考量 | 决策 |
|---|---|
| 职责边界 | `device-core` 关注设备抽象和感知管道，`world-model` 关注状态图和仿真推理，职责正交 |
| 依赖方向 | `world-model` 依赖 `device-core` 的 Percept 类型，反向不成立 |
| 独立演进 | 设备适配器（camera/lidar/arm）在 `device-core` 扩展，不触及 `world-model` |
| M9 复用 | `world-model` 的 WorldStateGraph 是 M9 多 Agent 共享世界状态的基础，独立包便于 M9 直接依赖 |

### 9.2 PerceptionPipeline 并行 vs 串行

采用 **按 modality 并行，同 modality 内串行** 策略：
- 不同模态（视觉、听觉、触觉）的处理器天然独立，并行执行提升吞吐
- 同一模态内可能有预处理→特征提取→语义理解的串联关系，保持顺序

### 9.3 WorldStateGraph 内存管理

采用 **TTL + confidence decay + 主动裁剪** 三重机制：
- TTL：硬性过期删除，防止遗忘的实体永久占用内存
- confidence decay：软性衰减，长时间未观测的实体置信度下降
- pruneExpired：每 cycle 主动清理，而非懒删除

### 9.4 ForwardSimulator 与 RuleBasedPredictor 共存

采用 **Predictor 链** 模式：
- `AgentProfile.prediction_config.predictor_order` 控制调用顺序
- 默认 `["rule-based", "simulation-based"]`
- 两者结果都记录到 PredictionStore，MetaController 综合评估
- 仿真超时或不可用时，RuleBasedPredictor 保底

---

## 10. 构建与发布

### 10.1 package.json 关键配置

```json
// packages/device-core/package.json
{
  "name": "@neurocore/device-core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "node --test dist/**/*.test.js"
  },
  "dependencies": {
    "@neurocore/protocol": "workspace:*"
  }
}
```

```json
// packages/world-model/package.json
{
  "name": "@neurocore/world-model",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "node --test dist/**/*.test.js"
  },
  "dependencies": {
    "@neurocore/protocol": "workspace:*",
    "@neurocore/device-core": "workspace:*"
  }
}
```

### 10.2 tsconfig.json

遵循现有 monorepo 约定，使用 `tsc -b`（增量编译）。
`references` 配置包依赖关系：

```json
// packages/world-model/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../protocol" },
    { "path": "../device-core" }
  ]
}
```
