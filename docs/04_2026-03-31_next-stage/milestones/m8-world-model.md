# M8: 世界模型与外部设备接入

> 方向 B · FR-36 ~ FR-43
> 详细设计: [03_world-model-and-devices.md](../03_world-model-and-devices.md)
> 依赖: 无
> 目标: Cerebellar 75% → 90%
> 状态: ⬜

---

## M8.1 Sensor SPI (FR-36) — P0

- [ ] 定义 `Sensor` / `SensorDescriptor` / `SensorReading` 接口 (`@neurocore/device-core`)
- [ ] `SensorDescriptor` 支持 `sensor_type` + `modality` 开放字符串
- [ ] `SensorReading` 同时支持 `raw_data_ref` 和 `structured_data`
- [ ] 实现 `MockCameraSensor` 验证接口可行性
- [ ] 单元测试: read / subscribe / start / stop

## M8.2 Actuator SPI (FR-37) — P0

- [ ] 定义 `Actuator` / `ActuatorDescriptor` / `ActuatorCommand` / `ActuatorResult` 接口 (`@neurocore/device-core`)
- [ ] `ActuatorCommand` 支持 `command_type` + `parameters` 开放结构
- [ ] `ActuatorResult` 包含 `status` / `duration_ms` / `error` / `side_effects`
- [ ] 实现 `MockSpeakerActuator` 验证接口可行性
- [ ] 单元测试: execute / emergencyStop / getStatus

## M8.3 Device Registry (FR-38) — P0

- [ ] 定义 `DeviceRegistry` 接口: register / unregister / query / listAll
- [ ] 实现 `InMemoryDeviceRegistry`
- [ ] 按 `sensor_type` / `actuator_type` / `modality` / `status` 查询
- [ ] 健康检测回调: `startHealthCheck` / `onHealthChange`
- [ ] emit `device.registered` / `device.error` 事件
- [ ] 支持运行时热插拔
- [ ] 单元测试: CRUD + 查询 + 健康检测 + 事件

## M8.4 Perception Pipeline (FR-39) — P1

- [ ] 定义 `PerceptionProcessor` SPI: `name` / `supported_modalities` / `process()`
- [ ] 定义 `PerceptionPipeline`: addProcessor / removeProcessor / ingest / ingestFromSensors
- [ ] 管道支持多级处理器串联
- [ ] 输出 `Percept` 结构化类型
- [ ] 全局超时和单处理器错误兜底
- [ ] 单元测试: 多处理器串联 / 超时 / 错误隔离

## M8.5 World State Graph (FR-40) — P0

- [ ] 定义 `WorldEntity` / `WorldRelation` / `WorldStateQuery` / `WorldStateDiff` 接口 (`@neurocore/world-model`)
- [ ] 定义 `WorldStateGraph` 接口: entity/relation CRUD + query + applyPercepts + decayConfidence + pruneExpired
- [ ] 实现 `InMemoryWorldStateGraph`
- [ ] `toDigest()` 输出 `WorldStateDigest` 供 `WorkspaceSnapshot` 使用
- [ ] 支持 TTL + confidence decay
- [ ] 单元测试: CRUD / query / decay / prune / toDigest

## M8.6 Forward Simulation (FR-41) — P1

- [ ] 定义 `SimulationResult` 接口
- [ ] 定义 `ForwardSimulator` SPI: simulate / simulateMultiple
- [ ] `SimulationBasedPredictor`: 适配器接入现有 Predictor SPI
- [ ] 仿真结果可用于 MetaController 决策
- [ ] 单元测试: simulate → SimulationResult / Predictor 适配

## M8.7 Active Inference (FR-42) — P2

- [ ] 定义 `FreeEnergyComponents` (risk / ambiguity / novelty / efe)
- [ ] 定义 `ActiveInferenceEvaluator` 接口: computeEFE
- [ ] EFE 分数作为 MetaController 新评分维度
- [ ] 单元测试: EFE 计算

## M8.8 Device Coordination (FR-43) — P2

- [ ] 定义 `SensorFusionStrategy` 接口
- [ ] 定义 `ActuatorOrchestrator` 接口: 串行/并行编排
- [ ] 融合冲突置信度仲裁
- [ ] 单元测试: 串行编排 / 并行编排 / 融合冲突

## M8.9 Integration & Regression

- [ ] 新增事件注册到 `NeuroCoreEventType`
- [ ] 新包 `@neurocore/device-core` 和 `@neurocore/world-model` 构建通过
- [ ] CycleEngine Perceive/Simulate/Act 阶段接入新模块
- [ ] 现有 132+ 测试全部通过（回归）
- [ ] `tsc --noEmit` 通过

---

## Acceptance Criteria

| # | 条件 |
|---|
| AC-1 | Sensor SPI 定义完成，MockCameraSensor 通过 read/subscribe 测试 |
| AC-2 | Actuator SPI 定义完成，MockSpeakerActuator 通过 execute/emergencyStop 测试 |
| AC-3 | DeviceRegistry 支持注册/注销/查询/健康检测，热插拔不需重启 |
| AC-4 | PerceptionPipeline 能将 SensorReading 转换为 Percept |
| AC-5 | WorldStateGraph 支持 entity/relation CRUD、query、decay、TTL prune |
| AC-6 | WorldStateGraph.toDigest() 输出可填充 WorkspaceSnapshot.world_state_digest |
| AC-7 | ForwardSimulator 能基于 WorldStateGraph + CandidateAction 输出 SimulationResult |
