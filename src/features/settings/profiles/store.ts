import { create } from "zustand";
import { readApiSessionGeneration } from "@/api/client/session";
import { useSettingsStore } from "../store/useSettingsStore";
import { settingsProfilesApi as api } from "./api";
import { registerProfileWriter } from "./bridge";
import {
  effectiveValues,
  editPreference,
  initialProfileState,
  reconcileProfiles,
  profileValues,
  type DeviceProfileState,
} from "./model";
import { mutateState, readState } from "./persistence";
import { portableValues, type PreferenceValue, type PreferenceValues } from "./registry";

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
  edit(
    id: string,
    value: PreferenceValue | undefined,
    target?: "profile" | "device",
  ): Promise<void>;
  select(id: string | null): Promise<void>;
  createProfile(name: string, source: "defaults" | "current" | string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  recover(id: string): Promise<void>;
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
        .applyProfileValues(effectiveValues(current), () => fresh(ctx));
  };
  projectionQueue = projectionQueue.catch(() => {}).then(project);
  await projectionQueue;
}
async function mutate(
  ctx: Context,
  reducer: (state: DeviceProfileState) => DeviceProfileState,
  notify = false,
) {
  const next = await mutateState(ctx.scope, () => initialProfileState(ctx.seed), reducer);
  await publish(ctx, next);
  if (notify && fresh(ctx)) ctx.channel?.postMessage("changed");
  return next;
}
function cloud<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
  const run = async () => {
    if (!fresh(ctx)) throw new Error("Account changed");
    if (!ctx.accountId) throw new Error("Sign in to manage synced profiles.");
    if (!navigator.onLine) throw new Error("Connect to the internet to manage profiles.");
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
  const { profiles } = await api.list();
  if (!fresh(ctx)) return;
  await mutate(ctx, (state) => reconcileProfiles(state, profiles));
  while (fresh(ctx)) {
    const saved = await readState<DeviceProfileState>(ctx.scope);
    const edit = saved.state?.outbox[0];
    if (!edit) break;
    const profile = await api.patch(edit);
    if (!fresh(ctx)) return;
    await mutate(ctx, (state) => {
      const next = structuredClone(state);
      if (!next.profiles[profile.id] || profile.revision >= next.profiles[profile.id].revision)
        next.profiles[profile.id] = profile;
      next.outbox = next.outbox.filter((m) => m.id !== edit.id);
      return next;
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
        (s) => s,
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
  edit: async (id, value, target) => {
    const ctx = requiredContext();
    try {
      const mutationId = crypto.randomUUID();
      await mutate(
        ctx,
        (state) =>
          editPreference(
            state,
            id,
            value,
            target ??
              (state.selectedProfileId &&
              state.overrides[state.selectedProfileId]?.[id] !== undefined
                ? "device"
                : "profile"),
            mutationId,
          ),
        true,
      );
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
  select: async (id) => {
    const ctx = requiredContext();
    try {
      await mutate(
        ctx,
        (state) => {
          if (id && !state.profiles[id])
            throw new Error("This profile is not available offline yet.");
          return {
            ...state,
            localValues: id === null ? effectiveValues(state) : state.localValues,
            selectedProfileId: id,
            notice: null,
          };
        },
        true,
      );
      set({ error: null });
    } catch (error) {
      report(error, ctx);
      throw error;
    }
  },
  createProfile: async (name, source) => {
    const ctx = requiredContext();
    await cloud(ctx, async () => {
      const state = (await readState<DeviceProfileState>(ctx.scope)).state;
      if (!state) throw new Error("Settings are still loading");
      const values: PreferenceValues =
        source === "defaults"
          ? {}
          : source === "current"
            ? effectiveValues(state)
            : profileValues(state, source);
      // Use the same allowlist for copies; never upload unknown future fields or local paths.
      const safe = portableValues((await import("./registry")).projectPreferences({}, values));
      const profile = await api.create(
        crypto.randomUUID(),
        name.trim(),
        source === "defaults" ? {} : safe,
      );
      if (!fresh(ctx)) return;
      await mutate(
        ctx,
        (current) => ({
          ...current,
          profiles: { ...current.profiles, [profile.id]: profile },
          selectedProfileId: profile.id,
          notice: null,
        }),
        true,
      );
    });
  },
  recover: async (id) => {
    const ctx = requiredContext();
    try {
      await mutate(
        ctx,
        (state) => {
          const values = state.overrides[id];
          if (!id.startsWith("deleted:") || !values) throw new Error("Recovery copy unavailable");
          const next = structuredClone(state);
          next.localValues = values;
          next.selectedProfileId = null;
          delete next.overrides[id];
          next.notice =
            "Recovered preferences are local to this device. Create a profile to sync them.";
          return next;
        },
        true,
      );
    } catch (error) {
      report(error, ctx);
      throw error;
    }
  },
  rename: async (id, name) => {
    const ctx = requiredContext();
    await cloud(ctx, async () => {
      const profile = await api.rename(id, name.trim(), crypto.randomUUID());
      if (!fresh(ctx)) return;
      await mutate(
        ctx,
        (state) => ({ ...state, profiles: { ...state.profiles, [id]: profile } }),
        true,
      );
    });
  },
  remove: async (id) => {
    const ctx = requiredContext();
    await cloud(ctx, async () => {
      await api.remove(id);
      if (!fresh(ctx)) return;
      await mutate(
        ctx,
        (state) =>
          reconcileProfiles(
            state,
            Object.values(state.profiles).filter((p) => p.id !== id),
          ),
        true,
      );
    });
  },
}));
