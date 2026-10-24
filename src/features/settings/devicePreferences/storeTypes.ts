import type { PreferenceWriteOptions } from "./bridge";
import { editPreference, type DevicePreferencesState } from "./model";
import { definitionById, type PreferenceValue } from "./registry";

// The device preferences store's shapes (store.ts) and the signatures it compares states by.

export interface Context {
  scope: string;
  epoch: number;
  seed: Record<string, unknown>;
  projected?: string;
  /** Edits already on screen that are not yet committed to this device's store. */
  pending: PendingEdit[];
  /** Edits shown but held for Save changes; also listed in `pending` so refreshes keep them. */
  staged: PendingEdit[];
  /** The saved state the staged edits are measured against. */
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
  /** Reads the saved settings again (another window may have changed them). */
  refresh(): Promise<void>;
  /** Unsaved edits are waiting on the settings page. */
  dirty: boolean;
  /** Bumps each time someone tries to leave with unsaved edits, so the save bar can react. */
  attention: number;
  edit(
    id: string,
    value: PreferenceValue | undefined,
    options?: PreferenceWriteOptions,
  ): Promise<void>;
  /** Commits every staged edit to this device. */
  saveStaged(): Promise<void>;
  /** Drops every staged edit and returns to what is saved. */
  discardStaged(): Promise<void>;
}
export const signatureOf = (values: Record<string, unknown>) =>
  JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
/** What each touched setting resolves to, so an explicit default equals no saved value. */
export function resolvedSignature(state: DevicePreferencesState) {
  return signatureOf(
    Object.fromEntries(
      Object.entries(state.values).filter(
        ([id, value]) => value !== definitionById.get(id)?.default,
      ),
    ),
  );
}
/** Keeps uncommitted edits visible over state read back from disk or another window. */
export function withPending(ctx: Context, state: DevicePreferencesState): DevicePreferencesState {
  return ctx.pending.reduce((current, edit) => editPreference(current, edit.id, edit.value), state);
}
