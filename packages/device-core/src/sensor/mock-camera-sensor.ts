import type { SensorDescriptor, SensorReading } from "../types.js";
import type { Sensor } from "./sensor.js";

export class MockCameraSensor implements Sensor {
  public descriptor: SensorDescriptor;
  private running = false;
  private subscribers = new Set<(reading: SensorReading) => void>();
  private frameCounter = 0;

  constructor(sensorId = "mock-camera-01") {
    this.descriptor = {
      sensor_id: sensorId,
      sensor_type: "camera",
      modality: "visual",
      capabilities: { supports_autofocus: true, max_resolution: { width: 1920, height: 1080 } },
      sampling_rate_hz: 30,
      resolution: { width: 1920, height: 1080 },
      status: "offline"
    };
  }

  async start(): Promise<void> {
    this.running = true;
    this.descriptor = { ...this.descriptor, status: "online" };
  }

  async stop(): Promise<void> {
    this.running = false;
    this.descriptor = { ...this.descriptor, status: "offline" };
    this.subscribers.clear();
  }

  async read(): Promise<SensorReading> {
    if (!this.running) {
      throw new Error(`Sensor ${this.descriptor.sensor_id} is not running`);
    }
    this.frameCounter++;
    const reading: SensorReading = {
      sensor_id: this.descriptor.sensor_id,
      timestamp: new Date().toISOString(),
      modality: "visual",
      raw_data_ref: `buffer://frame-${this.frameCounter}`,
      structured_data: {
        frame_number: this.frameCounter,
        width: 1920,
        height: 1080
      },
      confidence: 0.95
    };
    for (const cb of this.subscribers) {
      cb(reading);
    }
    return reading;
  }

  subscribe(callback: (reading: SensorReading) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
}
