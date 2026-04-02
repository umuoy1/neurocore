import type { AgentBuilder } from "@neurocore/sdk-core";
import { SqliteRuntimeStateStore } from "@neurocore/runtime-core";

export interface AssistantRuntimeFactoryOptions {
  dbPath: string;
  buildAgent: () => AgentBuilder;
}

export class AssistantRuntimeFactory {
  private readonly builder: AgentBuilder;

  public constructor(options: AssistantRuntimeFactoryOptions) {
    this.builder = options.buildAgent();
    this.builder.useRuntimeStateStore(
      () => new SqliteRuntimeStateStore({ filename: options.dbPath })
    );
  }

  public getBuilder(): AgentBuilder {
    return this.builder;
  }
}
