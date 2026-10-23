import { create } from "zustand";
import { useSettingsStore } from "../store/useSettingsStore";
import { registerPreferenceWriter, type PreferenceWriteOptions } from "./bridge";
import {
  effectiveValues,
  editPreference,
  initialPreferencesState,
  migratePreferencesState,
  type DevicePreferencesState,
} from "./model";
import { mutateState, readState } from "./persistence";
import { definitionById, type PreferenceValue } from "./registry";

interface Context {
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
interface PendingEdit {
  id: string;
  value: PreferenceValue | undefined;
}
interface DevicePreferencesStore {
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
let context: Context | null = null,
  epoch = 0;
/** True while the settings page is open; its edits are staged rather than committed. */
let stagingOn = false;
let projectionQueue: Promise<unknown> = Promise.resolve();
const fresh = (ctx: Context) => context === ctx;
function requiredContext() {
  if (!context || !useDevicePreferences.getState().ready)
    throw new Error("Settings are still loading");
  return context;
}
function report(error: unknown, ctx?: Context) {
  if (!ctx || fresh(ctx))
    useDevicePreferences.setState({
      error: error instanceof Error ? error.message : String(error),
    });
}
const signatureOf = (values: Record<string, unknown>) =>
  JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
/** What each touched setting resolves to, so an explicit default equals no saved value. */
function resolvedSignature(state: DevicePreferencesState) {
  return signatureOf(
    Object.fromEntries(
      Object.entries(state.values).filter(
        ([id, value]) => value !== definitionById.get(id)?.default,
      ),
    ),
  );
}
/** Keeps uncommitted edits visible over state read back from disk or another window. */
function withPending(ctx: Context, state: DevicePreferencesState): DevicePreferencesState {
  return ctx.pending.reduce((current, edit) => editPreference(current, edit.id, edit.value), state);
}
async function publish(ctx: Context, next: DevicePreferencesState) {
  if (!fresh(ctx)) return;
  useDevicePreferences.setState({ state: withPending(ctx, next) });
  const project = async () => {
    if (!fresh(ctx)) return;
    const current = useDevicePreferences.getState().state;
    if (!current) return;
    const values = effectiveValues(current);
    const signature = signatureOf(values);
    if (ctx.projected === signature) return;
    // A newer edit supersedes this projection; applying it would flash the old value back.
    const stillCurrent = () => {
      const latest = useDevicePreferences.getState().state;
      return fresh(ctx) && !!latest && signatureOf(effectiveValues(latest)) === signature;
    };
    try {
      await useSettingsStore.getState().applyPreferenceValues(values, stillCurrent);
      if (stillCurrent()) ctx.projected = signature;
    } catch (error) {
      // Failed platform effects can be retried by the next invalidation or focus.
      if (fresh(ctx))
        useSettingsStore.setState({
          error: `Could not apply settings: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
  };
  projectionQueue = projectionQueue.catch(() => {}).then(project);
  await projectionQueue;
}
async function mutate(
  ctx: Context,
  reducer: (state: DevicePreferencesState) => DevicePreferencesState,
  notify = false,
) {
  let changed = false;
  const next = await mutateState(
    ctx.scope,
    () => initialPreferencesState(ctx.seed),
    (state) => {
      const next = reducer(migratePreferencesState(state, ctx.seed));
      changed = next !== state;
      return next;
    },
  );
  await publish(ctx, next);
  if (notify && changed && fresh(ctx)) ctx.channel?.postMessage("changed");
  return next;
}
/** Commits an edit that is already on screen; on failure the screen returns to the saved value. */
async function persist(ctx: Context, edit: PendingEdit) {
  const settle = () => (ctx.pending = ctx.pending.filter((pending) => pending !== edit));
  try {
    await mutate(ctx, (state) => editPreference(state, edit.id, edit.value), true);
    settle();
  } catch (error) {
    settle();
    report(error, ctx);
    ctx.projected = undefined;
    const saved = await readState<DevicePreferencesState>(ctx.scope).catch(() => null);
    await publish(
      ctx,
      saved?.state
        ? migratePreferencesState(saved.state, ctx.seed)
        : initialPreferencesState(ctx.seed),
    ).catch(() => {});
    throw error;
  }
}
/** The settings page opens and closes staging; closing drops anything unsaved. */
export function setSettingsStaging(on: boolean) {
  stagingOn = on;
  if (!on && useDevicePreferences.getState().dirty)
    void useDevicePreferences
      .getState()
      .discardStaged()
      .catch(() => {});
}
/** True, and the save bar draws attention, when leaving settings would lose unsaved edits. */
export function blockIfUnsaved(): boolean {
  const { dirty, attention } = useDevicePreferences.getState();
  if (!dirty) return false;
  useDevicePreferences.setState({ attention: attention + 1 });
  return true;
}
export const useDevicePreferences = create<DevicePreferencesStore>((set, get) => ({
  state: null,
  ready: false,
  error: null,
  dirty: false,
  attention: 0,
  configure: async (scope, document) => {
    if (context?.scope === scope && get().ready) return;
    const ctx: Context = {
      scope,
      seed: structuredClone(document),
      epoch: ++epoch,
      pending: [],
      staged: [],
      writes: Promise.resolve(),
    };
    context?.channel?.close();
    context = ctx;
    if (typeof BroadcastChannel !== "undefined") {
      ctx.channel = new BroadcastChannel(`misty:profile-state:${scope}`);
      ctx.channel.onmessage = () => {
        void readState<DevicePreferencesState>(scope)
          .then((saved) => {
            if (saved.state) return publish(ctx, migratePreferencesState(saved.state, ctx.seed));
          })
          .catch((error) => report(error, ctx));
      };
    }
    registerPreferenceWriter(null);
    set({ state: null, ready: false, error: null, dirty: false });
    try {
      const state = await mutateState(
        scope,
        () => initialPreferencesState(document),
        (s) => migratePreferencesState(s, document),
      );
      if (!fresh(ctx)) return;
      await publish(ctx, state);
      if (!fresh(ctx)) return;
      set({ ready: true });
      registerPreferenceWriter((id, value, options) => get().edit(id, value, options));
    } catch (error) {
      report(error, ctx);
    }
  },
  disconnect: () => {
    context?.channel?.close();
    context = null;
    epoch++;
    registerPreferenceWriter(null);
    set({ state: null, ready: false, error: null, dirty: false });
  },
  refresh: async () => {
    const ctx = requiredContext();
    if (ctx.refresh) {
      ctx.refreshAgain = true;
      return ctx.refresh;
    }
    ctx.refresh = (async () => {
      try {
        do {
          ctx.refreshAgain = false;
          const saved = await readState<DevicePreferencesState>(ctx.scope);
          if (saved.state) await publish(ctx, migratePreferencesState(saved.state, ctx.seed));
        } while (ctx.refreshAgain && fresh(ctx));
      } catch (error) {
        report(error, ctx);
        throw error;
      } finally {
        ctx.refresh = undefined;
      }
    })();
    return ctx.refresh;
  },
  // The screen and the app's behavior change first; saving to this device follows.
  edit: async (id, value, options) => {
    const ctx = requiredContext();
    let write: Promise<void>;
    try {
      const current = get().state;
      if (!current) throw new Error("Settings are still loading");
      const next = editPreference(current, id, value);
      if (next === current) return;
      const edit: PendingEdit = { id, value };
      ctx.pending.push(edit);
      ctx.projected = undefined;
      set({ state: next, error: null });
      useSettingsStore.getState().previewPreferenceValues(effectiveValues(next));
      if (options?.stage && stagingOn) {
        // Shown and previewed now; written to this device when the person saves.
        ctx.baseline ??= current;
        ctx.staged.push(edit);
        const changed = resolvedSignature(next) !== resolvedSignature(ctx.baseline);
        if (!changed) {
          // Back to what is saved: nothing is left to save.
          ctx.pending = ctx.pending.filter((pending) => !ctx.staged.includes(pending));
          ctx.staged = [];
          ctx.baseline = undefined;
        }
        set({ dirty: changed });
        return;
      }
      // Edits commit in the order they were made, so the last one always wins on disk.
      write = ctx.writes.catch(() => {}).then(() => persist(ctx, edit));
      ctx.writes = write;
    } catch (error) {
      report(error, ctx);
      throw error;
    }
    await write;
  },
  saveStaged: async () => {
    const ctx = requiredContext();
    const edits = ctx.staged;
    ctx.staged = [];
    ctx.baseline = undefined;
    set({ dirty: false });
    let last: Promise<void> = ctx.writes.then(
      () => {},
      () => {},
    );
    for (const edit of edits) last = last.then(() => persist(ctx, edit));
    ctx.writes = last;
    await last;
  },
  discardStaged: async () => {
    const ctx = requiredContext();
    ctx.pending = ctx.pending.filter((pending) => !ctx.staged.includes(pending));
    ctx.staged = [];
    ctx.baseline = undefined;
    ctx.projected = undefined;
    set({ dirty: false });
    const saved = await readState<DevicePreferencesState>(ctx.scope).catch(() => null);
    await publish(
      ctx,
      saved?.state
        ? migratePreferencesState(saved.state, ctx.seed)
        : initialPreferencesState(ctx.seed),
    );
  },
}));
