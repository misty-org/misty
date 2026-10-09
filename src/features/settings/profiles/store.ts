import { create } from "zustand";
import { readApiSessionGeneration } from "@/api/client/session";
import { useSettingsStore } from "../store/useSettingsStore";
import { settingsProfilesApi as api } from "./api";
import { registerProfileWriter } from "./bridge";
import {
  effectiveValues,
  editPreference,
  initialProfileState,
  reconcileProfile,
  migrateProfileState,
  type DeviceProfileState,
  type ProfileMutation,
} from "./model";
import { mutateState, readState } from "./persistence";
import { type PreferenceValue } from "./registry";

interface Context {
  scope: string;
  accountId: string;
  epoch: number;
  session: number;
  seed: Record<string, unknown>;
  projected?: string;
  /** Edits already on screen that are not yet committed to this device's store. */
  pending: ProfileMutation[];
  writes: Promise<unknown>;
  channel?: BroadcastChannel;
  refresh?: Promise<void>;
  refreshAgain?: boolean;
}
interface ProfileStore {
  state: DeviceProfileState | null;
  ready: boolean;
  syncing: boolean;
  error: string | null;
  accountId: string;
  configure(scope: string, accountId: string, document: Record<string, unknown>): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
  edit(id: string, value: PreferenceValue | undefined): Promise<void>;
}
let context: Context | null = null,
  epoch = 0;
let cloudQueue: Promise<unknown> = Promise.resolve();
let projectionQueue: Promise<unknown> = Promise.resolve();
const fresh = (ctx: Context) => context === ctx && ctx.session === readApiSessionGeneration();
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
/** Keeps uncommitted edits visible over state read back from disk, other windows or the server. */
function withPending(ctx: Context, state: DeviceProfileState): DeviceProfileState {
  const missing = ctx.pending.filter(
    (edit) => !state.outbox.some((queued) => queued.id === edit.id),
  );
  return missing.length ? { ...state, outbox: [...state.outbox, ...missing] } : state;
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
function cloud<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
  const run = async () => {
    if (!fresh(ctx)) throw new Error("Account changed");
    if (!ctx.accountId) throw new Error("Sign in to sync settings.");
    if (!navigator.onLine) throw new Error("Connect to the internet to sync settings.");
    useSettingsProfiles.setState({ syncing: true, error: null });
    try {
      return await work();
    } catch (error) {
      report(error, ctx);
      throw error;
    } finally {
      if (fresh(ctx)) useSettingsProfiles.setState({ syncing: false });
    }
  };
  const result = cloudQueue
    .catch(() => {})
    .then(async (): Promise<T> => {
      if (navigator.locks)
        return await navigator.locks.request(`misty:profile-sync:${ctx.scope}`, run);
      return await run();
    });
  cloudQueue = result;
  return result;
}
/** Commits an edit that is already on screen; on failure the screen returns to the saved value. */
async function persist(
  ctx: Context,
  id: string,
  value: PreferenceValue | undefined,
  edit: ProfileMutation,
) {
  const settle = () => (ctx.pending = ctx.pending.filter((pending) => pending.id !== edit.id));
  try {
    await mutate(ctx, (state) => editPreference(state, id, value, edit.id), true);
    settle();
  } catch (error) {
    settle();
    report(error, ctx);
    ctx.projected = undefined;
    const saved = await readState<DeviceProfileState>(ctx.scope).catch(() => null);
    await publish(ctx, saved?.state ?? initialProfileState(ctx.seed)).catch(() => {});
    throw error;
  }
}
async function synchronize(ctx: Context) {
  if (!fresh(ctx)) return;
  const saved = await readState<DeviceProfileState>(ctx.scope);
  const profile = saved.state?.profile
    ? await api.read()
    : await api.ensure(saved.state?.seed ?? {});
  if (!fresh(ctx)) return;
  await mutate(ctx, (state) => reconcileProfile(state, profile));
  while (fresh(ctx)) {
    const saved = await readState<DeviceProfileState>(ctx.scope);
    const edit = saved.state?.outbox[0];
    if (!edit) break;
    const profile = await api.patch(edit);
    if (!fresh(ctx)) return;
    await mutate(ctx, (state) => {
      const next = reconcileProfile(state, profile);
      return { ...next, outbox: next.outbox.filter((m) => m.id !== edit.id) };
    });
  }
}
export const useSettingsProfiles = create<ProfileStore>((set, get) => ({
  state: null,
  ready: false,
  syncing: false,
  error: null,
  accountId: "",
  configure: async (scope, accountId, document) => {
    if (context?.scope === scope && get().ready) return;
    const ctx: Context = {
      scope,
      accountId,
      seed: structuredClone(document),
      epoch: ++epoch,
      session: readApiSessionGeneration(),
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
            if (saved.state) return publish(ctx, saved.state);
          })
          .catch((error) => report(error, ctx));
      };
    }
    registerProfileWriter(null);
    set({ state: null, ready: false, error: null, syncing: false, accountId });
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
      // The bridge's account observer owns initial/reset/focus reconciliation.
      // Starting another refresh here duplicates the initial pushed snapshot.
    } catch (error) {
      report(error, ctx);
    }
  },
  disconnect: () => {
    context?.channel?.close();
    context = null;
    epoch++;
    registerProfileWriter(null);
    set({ state: null, ready: false, accountId: "", error: null, syncing: false });
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
          if (saved.state) await publish(ctx, saved.state);
          if (ctx.accountId && navigator.onLine) await cloud(ctx, () => synchronize(ctx));
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
  // The screen and the app's behavior change first. Saving to this device follows, and the account
  // sync is deferred: the durable outbox delivers the edit whenever the server is reachable.
  edit: async (id, value) => {
    const ctx = requiredContext();
    let write: Promise<void>;
    try {
      if (!ctx.accountId) throw new Error("Sign in to change settings.");
      const current = get().state;
      if (!current) throw new Error("Settings are still loading");
      const next = editPreference(current, id, value, crypto.randomUUID());
      if (next === current) return;
      const edit = next.outbox[next.outbox.length - 1];
      ctx.pending.push(edit);
      ctx.projected = undefined;
      set({ state: next, error: null });
      useSettingsStore.getState().previewProfileValues(effectiveValues(next));
      // Edits commit in the order they were made, so the last one always wins on disk.
      write = ctx.writes.catch(() => {}).then(() => persist(ctx, id, value, edit));
      ctx.writes = write;
    } catch (error) {
      report(error, ctx);
      throw error;
    }
    await write;
    if (fresh(ctx) && ctx.accountId && navigator.onLine)
      void get()
        .refresh()
        .catch(() => {});
  },
}));
