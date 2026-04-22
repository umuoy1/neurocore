import type { ActuatorResult, ActuatorCommand } from "../types.js";
import type { DeviceRegistry } from "../registry/device-registry.js";

export type ActuatorExecutionMode = "serial" | "parallel";

export interface ActuatorOrchestrator {
  readonly name: string;
  execute(
    commands: ActuatorCommand[],
    registry: DeviceRegistry,
    mode: ActuatorExecutionMode
  ): Promise<ActuatorResult[]>;
}

export class DefaultActuatorOrchestrator implements ActuatorOrchestrator {
  public readonly name = "default-actuator-orchestrator";

  public async execute(
    commands: ActuatorCommand[],
    registry: DeviceRegistry,
    mode: ActuatorExecutionMode
  ): Promise<ActuatorResult[]> {
    if (mode === "parallel") {
      const settled = await Promise.allSettled(commands.map((command) => runCommand(command, registry)));
      return settled.map((result, index) => result.status === "fulfilled"
        ? result.value
        : failedResult(commands[index], result.reason));
    }

    const results: ActuatorResult[] = [];
    for (const command of commands) {
      try {
        const result = await runCommand(command, registry);
        results.push(result);
        if (result.status !== "completed") {
          break;
        }
      } catch (error) {
        results.push(failedResult(command, error));
        break;
      }
    }
    return results;
  }
}

async function runCommand(command: ActuatorCommand, registry: DeviceRegistry): Promise<ActuatorResult> {
  const actuator = registry.getActuator(command.actuator_id);
  if (!actuator) {
    return failedResult(command, `Unknown actuator: ${command.actuator_id}`);
  }
  return actuator.execute(command);
}

function failedResult(command: ActuatorCommand, error: unknown): ActuatorResult {
  return {
    command_id: command.command_id,
    actuator_id: command.actuator_id,
    command_type: command.command_type,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    duration_ms: 0
  };
}
