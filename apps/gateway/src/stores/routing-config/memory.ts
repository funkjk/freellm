import type { RoutingStrategy } from "../../types.js";
import type { RoutingConfigStore } from "./types.js";

export class MemoryRoutingConfigStore implements RoutingConfigStore {
  private strategy: RoutingStrategy = "round_robin";

  async getStrategy(): Promise<RoutingStrategy> {
    return this.strategy;
  }

  async setStrategy(strategy: RoutingStrategy): Promise<void> {
    this.strategy = strategy;
  }
}
