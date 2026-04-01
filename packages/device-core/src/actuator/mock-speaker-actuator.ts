import type { ActuatorCommand, ActuatorDescriptor, ActuatorResult } from "../types.js";
import type { Actuator } from "./actuator.js";

export class MockSpeakerActuator implements Actuator {
  public descriptor: ActuatorDescriptor;
  private status: ActuatorDescriptor["status"] = "offline";

  constructor(actuatorId = "mock-speaker-01") {
    this.descriptor = {
      actuator_id: actuatorId,
      actuator_type: "speaker",
      modality: "auditory",
      capabilities: {
        supported_languages: ["zh-CN", "en-US"],
        voice_models: ["default", "expressive-v2"],
        max_text_length: 4096
      },
      status: "offline"
    };
  }

  async initialize(): Promise<void> {
    this.status = "ready";
    this.descriptor = { ...this.descriptor, status: "ready" };
  }

  async execute(command: ActuatorCommand): Promise<ActuatorResult> {
    if (this.status !== "ready") {
      return {
        command_id: command.command_id,
        actuator_id: this.descriptor.actuator_id,
        command_type: command.command_type,
        status: "failed",
        error: "Actuator not initialized",
        duration_ms: 0
      };
    }

    this.status = "busy";
    this.descriptor = { ...this.descriptor, status: "busy" };

    const startTime = Date.now();

    try {
      if (command.timeout_ms !== undefined && command.timeout_ms <= 0) {
        return {
          command_id: command.command_id,
          actuator_id: this.descriptor.actuator_id,
          command_type: command.command_type,
          status: "timeout",
          duration_ms: Date.now() - startTime
        };
      }

      const text = command.parameters.text as string | undefined;
      const durationMs = text ? Math.min(text.length * 50, 5000) : 100;

      await new Promise((resolve) => setTimeout(resolve, 1));

      return {
        command_id: command.command_id,
        actuator_id: this.descriptor.actuator_id,
        command_type: command.command_type,
        status: "completed",
        result: {
          text_spoken: text ?? "",
          voice_model: command.parameters.voice_model_ref ?? "default"
        },
        duration_ms: durationMs,
        side_effects: ["audio_output"]
      };
    } finally {
      this.status = "ready";
      this.descriptor = { ...this.descriptor, status: "ready" };
    }
  }

  async stop(): Promise<void> {
    this.status = "offline";
    this.descriptor = { ...this.descriptor, status: "offline" };
  }

  async emergencyStop(): Promise<void> {
    this.status = "offline";
    this.descriptor = { ...this.descriptor, status: "offline" };
  }

  getStatus(): ActuatorDescriptor["status"] {
    return this.status;
  }
}
