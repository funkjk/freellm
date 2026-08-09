import type { RequestLogEntry } from "../../types.js";

export interface RequestLogStore {
  append(entry: RequestLogEntry): Promise<void>;
  getRecent(limit: number): Promise<RequestLogEntry[]>;
  clear(): Promise<void>;
}
