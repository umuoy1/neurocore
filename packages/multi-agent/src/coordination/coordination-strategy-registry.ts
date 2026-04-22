import type { CoordinationStrategy } from "./coordination-strategy.js";
import { HierarchicalStrategy } from "./hierarchical-strategy.js";
import { PeerToPeerStrategy } from "./peer-to-peer-strategy.js";
import { MarketBasedStrategy } from "./market-based-strategy.js";
import type { CoordinationStrategyName, MultiAgentConfig } from "../types.js";

export class CoordinationStrategyRegistry {
  private readonly strategies = new Map<CoordinationStrategyName, CoordinationStrategy>();

  public constructor() {
    this.strategies.set("hierarchical", new HierarchicalStrategy());
    this.strategies.set("peer_to_peer", new PeerToPeerStrategy());
    this.strategies.set("market_based", new MarketBasedStrategy());
  }

  public register(name: CoordinationStrategyName, strategy: CoordinationStrategy): void {
    this.strategies.set(name, strategy);
  }

  public resolve(config?: Pick<MultiAgentConfig, "coordination_strategy">): CoordinationStrategy {
    const name = config?.coordination_strategy ?? "hierarchical";
    return this.strategies.get(name) ?? this.strategies.get("hierarchical")!;
  }
}
