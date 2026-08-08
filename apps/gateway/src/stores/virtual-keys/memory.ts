import type { VirtualKeyCounterSnapshot, VirtualKeyCounterStore } from "./types.js";

export class MemoryVirtualKeyCounterStore implements VirtualKeyCounterStore {
  private counters = new Map<string, VirtualKeyCounterSnapshot>();

  async get(keyId: string): Promise<VirtualKeyCounterSnapshot> {
    const existing = this.counters.get(keyId);
    if (existing) {
      return {
        requestTimes: [...existing.requestTimes],
        tokenEvents: existing.tokenEvents.map((e) => ({ ...e })),
      };
    }
    return { requestTimes: [], tokenEvents: [] };
  }

  async set(keyId: string, snapshot: VirtualKeyCounterSnapshot): Promise<void> {
    this.counters.set(keyId, {
      requestTimes: [...snapshot.requestTimes],
      tokenEvents: snapshot.tokenEvents.map((e) => ({ ...e })),
    });
  }
}
