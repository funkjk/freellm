import type { RequestLogEntry } from "../../types.js";
import type { RequestLogStore } from "./types.js";

export class MemoryRequestLogStore implements RequestLogStore {
  private entries: RequestLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  async append(entry: RequestLogEntry): Promise<void> {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
  }

  async getRecent(limit: number): Promise<RequestLogEntry[]> {
    return this.entries.slice(0, Math.max(0, limit));
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}
