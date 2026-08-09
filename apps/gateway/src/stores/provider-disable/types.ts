/** Runtime operator disable flags for providers (separate from "has API keys"). */
export interface ProviderDisableStore {
  isDisabled(providerId: string): Promise<boolean>;
  setDisabled(providerId: string, disabled: boolean): Promise<void>;
  listDisabled(): Promise<string[]>;
}
