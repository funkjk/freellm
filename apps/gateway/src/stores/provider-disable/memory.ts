import type { ProviderDisableStore } from "./types.js";

export class MemoryProviderDisableStore implements ProviderDisableStore {
  private disabled = new Set<string>();

  async isDisabled(providerId: string): Promise<boolean> {
    return this.disabled.has(providerId);
  }

  async setDisabled(providerId: string, disabled: boolean): Promise<void> {
    if (disabled) this.disabled.add(providerId);
    else this.disabled.delete(providerId);
  }

  async listDisabled(): Promise<string[]> {
    return [...this.disabled].sort();
  }
}
