import { deploymentStorageKey } from "@/api/deployment/api";
import { ApiRequestError } from "@/api/client/errors";
import { appsApi, type OfficialApp, type SpaceAppInstallation } from "@/api/apps";
import { assertStableApiSession, readApiSessionGeneration } from "@/api/client";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { isNavigatorAppId, type NavigatorAppId } from "@/features/workspace/navigatorApps";

type Installation = SpaceAppInstallation;
interface AppsState {
  accountId: string;
  catalog: OfficialApp[];
  installations: Installation[];
  ready: boolean;
  loading: boolean;
  actionAppId: string;
  error: string;
  selectAccount: (accountId: string) => void;
  load: (accountId: string, force?: boolean, legacySpaceId?: string) => Promise<void>;
  invalidate: (accountId: string, legacySpaceId?: string) => Promise<void>;
  adoptOnboarding: (accountId: string, installations: Installation[]) => void;
  install: (app: OfficialApp) => Promise<void>;
  uninstall: (appId: string) => Promise<void>;
  setPinned: (appId: string, pinned: boolean) => Promise<void>;
  reorder: (appIds: string[]) => Promise<void>;
  reset: () => void;
}
const emptyState = () => ({
  accountId: "",
  catalog: [] as OfficialApp[],
  installations: [] as Installation[],
  ready: false,
  loading: false,
  actionAppId: "",
  error: "",
});
const pinKey = (accountId: string, appId: string) =>
  deploymentStorageKey(`misty:personal-app-pins:v1:${accountId}:${appId}`);
export const useAppsStore = create<AppsState>((set, get) => {
  let epoch = 0;
  let pending: Promise<void> | undefined;
  let refresh: Promise<void> | undefined;
  let retryAfter = 0;
  function identity(account: string, generation: number, revision: number) {
    assertStableApiSession(generation);
    if (get().accountId !== account || epoch !== revision)
      throw new Error("The account changed. Try again.");
  }
  function accept(apps: Installation[]) {
    const incoming = apps.map((app) => ({
      ...app,
      pinned: localStorage.getItem(pinKey(get().accountId, app.app_id)) !== "false",
    }));
    set({
      installations:
        JSON.stringify(incoming) === JSON.stringify(get().installations)
          ? get().installations
          : incoming,
      ready: true,
      loading: false,
      error: "",
    });
  }
  async function change(appId: string, action: () => Promise<unknown>) {
    const { accountId } = get();
    if (!accountId) throw new Error("Sign in to manage your apps.");
    if (get().actionAppId) throw new Error("Wait for the current app change to finish.");
    const revision = epoch,
      generation = readApiSessionGeneration();
    set({ actionAppId: appId, error: "" });
    try {
      await action();
      identity(accountId, generation, revision);
      const result = await appsApi.installations();
      identity(accountId, generation, revision);
      accept(result.apps);
    } catch (error) {
      if (epoch === revision) set({ error: errorText(error) });
      throw error;
    } finally {
      if (epoch === revision) set({ actionAppId: "" });
    }
  }
  return {
    ...emptyState(),
    selectAccount(accountId) {
      if (accountId !== get().accountId) {
        get().reset();
        set({ accountId });
      }
      if (accountId) void get().load(accountId);
    },
    async load(accountId, force = false) {
      if (!accountId) return;
      if (accountId !== get().accountId) {
        get().reset();
        set({ accountId });
      }
      if (pending) return pending;
      if ((get().ready && !force) || Date.now() < retryAfter) return;
      const revision = epoch,
        generation = readApiSessionGeneration();
      set({ loading: true, error: "" });
      const operation = (async () => {
        try {
          const [catalog, installed] = await Promise.all([
            appsApi.catalog(),
            appsApi.installations(),
          ]);
          identity(accountId, generation, revision);
          set({
            catalog: catalog.apps.filter((app) => app.id !== "transfers" && app.id !== "agents"),
          });
          accept(installed.apps);
        } catch (error) {
          if (epoch !== revision) return;
          const lost = error instanceof ApiRequestError && [401, 403, 404].includes(error.status);
          if (error instanceof ApiRequestError && error.status === 429)
            retryAfter = Date.now() + (error.retryAfterMs ?? 60000);
          set({
            loading: false,
            error: errorText(error),
            ...(lost ? { ready: false, installations: [] } : {}),
          });
        } finally {
          if (epoch === revision) pending = undefined;
        }
      })();
      pending = operation;
      return operation;
    },
    async invalidate(accountId) {
      if (refresh) return refresh;
      const revision = epoch;
      const operation = (async () => {
        if (pending) await pending;
        if (epoch === revision && get().accountId === accountId) await get().load(accountId, true);
      })().finally(() => {
        if (refresh === operation) refresh = undefined;
      });
      refresh = operation;
      return operation;
    },
    adoptOnboarding(accountId, apps) {
      if (accountId !== get().accountId) {
        get().reset();
        set({ accountId });
      }
      accept(apps);
    },
    install: (app) => change(app.id, () => appsApi.install("", app.id, app.permission_version)),
    uninstall: (id) => change(id, () => appsApi.uninstall("", id)),
    reorder: (ids) => change("order", () => appsApi.reorder("", ids)),
    async setPinned(appId, pinned) {
      if (!get().installations.some((app) => app.app_id === appId && app.state === "installed"))
        return;
      localStorage.setItem(pinKey(get().accountId, appId), String(pinned));
      accept(get().installations);
    },
    reset() {
      epoch++;
      pending = undefined;
      refresh = undefined;
      retryAfter = 0;
      set(emptyState());
    },
  };
});
export function installedAppIds(installations: Installation[]) {
  return installations.filter((item) => item.state === "installed").map((item) => item.app_id);
}
export function pinnedAppIds(installations: Installation[]) {
  return installations
    .filter((item) => item.state === "installed" && item.pinned !== false)
    .sort((a, b) => a.pin_rank - b.pin_rank)
    .map((item) => item.app_id);
}
function navigatorIds(installations: Installation[], pinnedOnly: boolean): NavigatorAppId[] {
  return (pinnedOnly ? pinnedAppIds(installations) : installedAppIds(installations))
    .map((id) => (id === "chat" ? "social" : id))
    .filter(isNavigatorAppId);
}
export function useInstalledNavigatorAppIds() {
  return useAppsStore(useShallow((state) => navigatorIds(state.installations, false)));
}
export function usePinnedNavigatorAppIds() {
  return useAppsStore(useShallow((state) => navigatorIds(state.installations, true)));
}

export function navigatorAppIdForOfficialApp(appId: string): NavigatorAppId | null {
  return appId === "chat" ? "social" : isNavigatorAppId(appId) ? appId : null;
}
export function officialAppIdForNavigator(appId: NavigatorAppId): string {
  return appId === "social" ? "chat" : appId;
}

export function resetAppsAccountState(): void {
  useAppsStore.getState().reset();
}
