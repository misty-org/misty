import type { PreferenceWriteOptions } from "./bridge";
import { editPreference, type DevicePreferencesState } from "./setting_resolution";
import { definitionById, type PreferenceValue } from "./registry";

export interface Context {
  scope: string;
  epoch: number;
  seed: Record<string, unknown>;
  projected?: string;
  pending: PendingEdit[];
  staged: PendingEdit[];
  baseline?: DevicePreferencesState;
  writes: Promise<unknown>;
  channel?: BroadcastChannel;
  refresh?: Promise<void>;
  refreshAgain?: boolean;
}
export interface PendingEdit {
  id: string;
  value: PreferenceValue | undefined;
}
export interface DevicePreferencesStore {
  state: DevicePreferencesState | null;
  ready: boolean;
  error: string | null;
  configure(scope: string, document: Record<string, unknown>): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
  dirty: boolean;
  attention: number;
  edit(
    id: string,
    value: PreferenceValue | undefined,
    options?: PreferenceWriteOptions,
  ): Promise<void>;
  saveStaged(): Promise<void>;
  discardStaged(): Promise<void>;
}
export const signatureOf = (values: Record<string, unknown>) =>
  JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
export function resolvedSignature(state: DevicePreferencesState) {
  return signatureOf(
    Object.fromEntries(
      Object.entries(state.values).filter(
        ([id, value]) => value !== definitionById.get(id)?.default,
      ),
    ),
  );
}
export function withPending(ctx: Context, state: DevicePreferencesState): DevicePreferencesState {
  return ctx.pending.reduce((current, edit) => editPreference(current, edit.id, edit.value), state);
}
