export interface VirtualKeyCounterSnapshot {
  requestTimes: number[];
  tokenEvents: Array<{ at: number; tokens: number }>;
}

/**
 * Rolling-window counters for virtual key soft caps.
 * Key definitions stay in VirtualKeyStore; only mutable counters live here.
 */
export interface VirtualKeyCounterStore {
  get(keyId: string): Promise<VirtualKeyCounterSnapshot>;
  set(keyId: string, snapshot: VirtualKeyCounterSnapshot): Promise<void>;
}
