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
} from "./model";
import { mutateState, readState } from "./persistence";
import { type PreferenceValue } from "./registry";

interface Context {
  scope: string;
  accountId: string;
  epoch: number;
  session: number;
  seed: Record<string, unknown>;
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
async function publish(ctx: Context, next: DeviceProfileState) {
  if (!fresh(ctx)) return;
  useSettingsProfiles.setState({ state: next });
  const project = async () => {
    if (!fresh(ctx)) return;
    const current = useSettingsProfiles.getState().state;
    if (current)
      await useSettingsStore
        .getState()
        .applyProfileValues(effectiveValues(current), () => fresh(ctx))
        .catch((error) => {
          // A platform integration failure must not prevent the preference from syncing.
          if (fresh(ctx))
            useSettingsStore.setState({
              error: `Could not apply settings: ${error instanceof Error ? error.message : String(error)}`,
            });
        });
  };
  projectionQueue = projectionQueue.catch(() => {}).then(project);
  await projectionQueue;
}
async function mutate(
  ctx: Context,
  reducer: (state: DeviceProfileState) => DeviceProfileState,
  notify = false,
) {
  const next = await mutateState(
    ctx.scope,
    () => initialProfileState(ctx.seed),
    (state) => reducer(migrateProfileState(state, ctx.seed)),
  );
  await publish(ctx, next);
  if (notify && fresh(ctx)) ctx.channel?.postMessage("changed");
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
async function synchronize(ctx: Context) {
  if (!fresh(ctx)) return;
  const saved = await readState<DeviceProfileState>(ctx.scope);
  const profile = await api.ensure(saved.state?.seed ?? {});
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
      if (accountId && navigator.onLine)
        void get()
          .refresh()
          .catch(() => {});
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
  edit: async (id, value) => {
    const ctx = requiredContext();
    try {
      if (!ctx.accountId) throw new Error("Sign in to change settings.");
      const mutationId = crypto.randomUUID();
      await mutate(ctx, (state) => editPreference(state, id, value, mutationId), true);
      if (fresh(ctx)) set({ error: null });
      if (ctx.accountId && navigator.onLine)
        void get()
          .refresh()
          .catch(() => {});
    } catch (error) {
      report(error, ctx);
      throw error;
    }
  },
}));
