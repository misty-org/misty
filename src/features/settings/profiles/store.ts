import { create } from "zustand";
import { useSettingsStore } from "../store/useSettingsStore";
import { registerProfileWriter } from "./bridge";
import {
  effectiveValues,
  editPreference,
  initialProfileState,
  migrateProfileState,
  type DeviceProfileState,
} from "./model";
import { mutateState, readState } from "./persistence";
import { type PreferenceValue } from "./registry";

interface Context {
  scope: string;
  epoch: number;
  seed: Record<string, unknown>;
  projected?: string;
  /** Edits already on screen that are not yet committed to this device's store. */
  pending: PendingEdit[];
  writes: Promise<unknown>;
  channel?: BroadcastChannel;
  refresh?: Promise<void>;
  refreshAgain?: boolean;
}
interface PendingEdit {
  id: string;
  value: PreferenceValue | undefined;
}
interface ProfileStore {
  state: DeviceProfileState | null;
  ready: boolean;
  error: string | null;
  configure(scope: string, document: Record<string, unknown>): Promise<void>;
  disconnect(): void;
  /** Reads the saved settings again (another window may have changed them). */
  refresh(): Promise<void>;
  edit(id: string, value: PreferenceValue | undefined): Promise<void>;
}
let context: Context | null = null,
  epoch = 0;
let projectionQueue: Promise<unknown> = Promise.resolve();
const fresh = (ctx: Context) => context === ctx;
function requiredContext() {
  if (!context || !useSettingsProfiles.getState().ready)
    throw new Error("Settings are still loading");
  return context;
}
function report(error: unknown, ctx?: Context) {
  if (!ctx || fresh(ctx))
    useSettingsProfiles.setState({ error: error instanceof Error ? error.message : String(error) });
}
const signatureOf = (values: Record<string, unknown>) =>
  JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
/** Keeps uncommitted edits visible over state read back from disk or another window. */
function withPending(ctx: Context, state: DeviceProfileState): DeviceProfileState {
  return ctx.pending.reduce((current, edit) => editPreference(current, edit.id, edit.value), state);
}
async function publish(ctx: Context, next: DeviceProfileState) {
  if (!fresh(ctx)) return;
  useSettingsProfiles.setState({ state: withPending(ctx, next) });
  const project = async () => {
    if (!fresh(ctx)) return;
    const current = useSettingsProfiles.getState().state;
    if (!current) return;
    const values = effectiveValues(current);
    const signature = signatureOf(values);
    if (ctx.projected === signature) return;
    // A newer edit supersedes this projection; applying it would flash the old value back.
    const stillCurrent = () => {
      const latest = useSettingsProfiles.getState().state;
      return fresh(ctx) && !!latest && signatureOf(effectiveValues(latest)) === signature;
    };
    try {
      await useSettingsStore.getState().applyProfileValues(values, stillCurrent);
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
  reducer: (state: DeviceProfileState) => DeviceProfileState,
  notify = false,
) {
  let changed = false;
  const next = await mutateState(
    ctx.scope,
    () => initialProfileState(ctx.seed),
    (state) => {
      const next = reducer(migrateProfileState(state, ctx.seed));
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
    const saved = await readState<DeviceProfileState>(ctx.scope).catch(() => null);
    await publish(
      ctx,
      saved?.state ? migrateProfileState(saved.state, ctx.seed) : initialProfileState(ctx.seed),
    ).catch(() => {});
    throw error;
  }
}
export const useSettingsProfiles = create<ProfileStore>((set, get) => ({
  state: null,
  ready: false,
  error: null,
  configure: async (scope, document) => {
    if (context?.scope === scope && get().ready) return;
    const ctx: Context = {
      scope,
      seed: structuredClone(document),
      epoch: ++epoch,
      pending: [],
      writes: Promise.resolve(),
    };
    context?.channel?.close();
    context = ctx;
    if (typeof BroadcastChannel !== "undefined") {
      ctx.channel = new BroadcastChannel(`misty:profile-state:${scope}`);
      ctx.channel.onmessage = () => {
        void readState<DeviceProfileState>(scope)
          .then((saved) => {
            if (saved.state) return publish(ctx, migrateProfileState(saved.state, ctx.seed));
          })
          .catch((error) => report(error, ctx));
      };
    }
    registerProfileWriter(null);
    set({ state: null, ready: false, error: null });
    try {
      const state = await mutateState(
        scope,
        () => initialProfileState(document),
        (s) => migrateProfileState(s, document),
      );
      if (!fresh(ctx)) return;
      await publish(ctx, state);
      if (!fresh(ctx)) return;
      set({ ready: true });
      registerProfileWriter((id, value) => get().edit(id, value));
    } catch (error) {
      report(error, ctx);
    }
  },
  disconnect: () => {
    context?.channel?.close();
    context = null;
    epoch++;
    registerProfileWriter(null);
    set({ state: null, ready: false, error: null });
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
          const saved = await readState<DeviceProfileState>(ctx.scope);
          if (saved.state) await publish(ctx, migrateProfileState(saved.state, ctx.seed));
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
  edit: async (id, value) => {
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
      useSettingsStore.getState().previewProfileValues(effectiveValues(next));
      // Edits commit in the order they were made, so the last one always wins on disk.
      write = ctx.writes.catch(() => {}).then(() => persist(ctx, edit));
      ctx.writes = write;
    } catch (error) {
      report(error, ctx);
      throw error;
    }
    await write;
  },
}));
