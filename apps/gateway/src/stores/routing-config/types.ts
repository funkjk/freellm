import type { RoutingStrategy } from "../../types.js";

export interface RoutingConfigStore {
  getStrategy(): Promise<RoutingStrategy>;
  setStrategy(strategy: RoutingStrategy): Promise<void>;
}
