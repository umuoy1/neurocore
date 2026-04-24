import type { MemoryGate, MemoryLayer, MemoryProvider, MemoryRetrievalPlan, ModuleContext } from "@neurocore/protocol";

export abstract class BaseMemoryGate implements MemoryGate {
  public abstract readonly name: string;

  public abstract plan(input: {
    ctx: ModuleContext;
    providers: MemoryProvider[];
  }): Promise<MemoryRetrievalPlan>;

  protected layersForProviders(providers: MemoryProvider[]): MemoryLayer[] {
    const inferred = providers.map((provider) => provider.layer ?? inferLayer(provider.name));
    return [...new Set(inferred)];
  }
}

export function inferLayer(providerName: string): MemoryLayer {
  if (providerName.includes("working")) {
    return "working";
  }
  if (providerName.includes("semantic")) {
    return "semantic";
  }
  if (providerName.includes("procedural") || providerName.includes("skill")) {
    return "procedural";
  }
  return "episodic";
}
