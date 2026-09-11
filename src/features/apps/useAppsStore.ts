import { deploymentStorageKey } from "@/api/deployment/api";
import { ApiRequestError } from "@/api/client/errors";
import { appsApi, type OfficialApp, type SpaceAppInstallation } from "@/api/apps";
import { assertStableApiSession, readApiSessionGeneration } from "@/api/client";
import { useSpacesStore } from "@/features/spaces/core";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { isNavigatorAppId, type NavigatorAppId } from "@/features/workspace/navigatorApps";

type Installation = SpaceAppInstallation;
interface AppsState {
  accountId: string;
  spaceId: string;
  catalog: OfficialApp[];
  installations: Installation[];
  bySpace: Record<string, Installation[]>;
  bySpaceErrors: Record<string, string>;
  prefetchSpaceAccess: (retryFailed?: boolean) => Promise<void>;
  ready: boolean;
  loading: boolean;
  actionAppId: string;
  error: string;
  selectSpace: (accountId: string, spaceId: string) => void;
  load: (accountId: string, force?: boolean, spaceId?: string) => Promise<void>;
  invalidate: (accountId: string, spaceId: string) => Promise<void>;
  adoptOnboarding: (accountId: string, installations: Installation[]) => void;
  install: (app: OfficialApp) => Promise<void>;
  setSpaceEnabled: (app: OfficialApp, spaceId: string, enabled: boolean) => Promise<void>;
  setPinned: (appId: string, pinned: boolean) => Promise<void>;
  reorder: (appIds: string[]) => Promise<void>;
  uninstall: (appId: string) => Promise<void>;
  reset: () => void;
}
const emptyState = () => ({
  accountId: "",
  spaceId: "",
  catalog: [] as OfficialApp[],
  installations: [] as Installation[],
  bySpace: {} as Record<string, Installation[]>,
  bySpaceErrors: {} as Record<string, string>,
  ready: false,
  loading: false,
  actionAppId: "",
  error: "",
});
export function canManageSpaceApps(spaceId: string): boolean {
  const space = useSpacesStore.getState().spaces.find((item) => item.id === spaceId);
  return !!space && (space.role === "owner" || space.permissions?.["apps.manage"] === true);
}
function pinKey(accountId: string, spaceId: string, appId: string) {
  return deploymentStorageKey(`misty:space-app-pins:v1:${accountId}:${spaceId}:${appId}`);
}
function withPersonalPins(accountId: string, spaceId: string, apps: Installation[]) {
  return apps.map((app) => ({
    ...app,
    pinned: localStorage.getItem(pinKey(accountId, spaceId, app.app_id)) !== "false",
  }));
}
export const useAppsStore = create<AppsState>((set, get) => {
  let epoch = 0;
  const requests = new Map<string, Promise<void>>();
  let catalogRequest: ReturnType<typeof appsApi.catalog> | undefined;
  const invalidations = new Map<string, Promise<void>>();
  let cachedCatalog: Awaited<ReturnType<typeof appsApi.catalog>> | undefined;
  let catalogLoadedAt: number | null = null;
  let retryAfter = 0;
  function loadCatalog() {
    if (catalogLoadedAt !== null && Date.now() - catalogLoadedAt < 15_000)
      return Promise.resolve(cachedCatalog!);
    if (catalogRequest) return catalogRequest;
    const ownEpoch = epoch;
    const pending = appsApi
      .catalog()
      .then((result) => {
        if (epoch === ownEpoch) {
          cachedCatalog = result;
          catalogLoadedAt = Date.now();
        }
        return result;
      })
      .finally(() => {
        if (catalogRequest === pending) catalogRequest = undefined;
      });
    catalogRequest = pending;
    return pending;
  }
  function assertIdentity(accountId: string, generation: number, ownEpoch: number) {
    assertStableApiSession(generation);
    if (get().accountId !== accountId || epoch !== ownEpoch)
      throw new Error("The account changed. Try again.");
  }
  function accept(spaceId: string, apps: Installation[]) {
    const incoming = withPersonalPins(get().accountId, spaceId, apps);
    const previous = get().bySpace[spaceId];
    const installations =
      JSON.stringify(previous) === JSON.stringify(incoming) ? previous! : incoming;
    set((state) => ({
      bySpace:
        state.bySpace[spaceId] === installations
          ? state.bySpace
          : { ...state.bySpace, [spaceId]: installations },
      bySpaceErrors: { ...state.bySpaceErrors, [spaceId]: "" },
      ...(state.spaceId === spaceId
        ? { installations, ready: true, loading: false, error: "" }
        : {}),
    }));
  }
  async function change(
    appId: string,
    run: (spaceId: string) => Promise<unknown>,
    targetSpaceId = get().spaceId,
  ) {
    const { accountId } = get();
    const spaceId = targetSpaceId;
    if (!canManageSpaceApps(spaceId)) throw new Error("Ask a Space manager to change its apps.");
    if (get().actionAppId) throw new Error("Wait for the current app change to finish.");
    const generation = readApiSessionGeneration(),
      ownEpoch = epoch;
    set({ actionAppId: appId, error: "" });
    try {
      await run(spaceId);
      assertIdentity(accountId, generation, ownEpoch);
      const result = await appsApi.installations(spaceId);
      assertIdentity(accountId, generation, ownEpoch);
      accept(spaceId, result.apps);
    } catch (error) {
      if (get().accountId === accountId && ownEpoch === epoch) set({ error: errorText(error) });
      throw error;
    } finally {
      if (get().accountId === accountId && ownEpoch === epoch) set({ actionAppId: "" });
    }
  }
  return {
    ...emptyState(),
    selectSpace(accountId, spaceId) {
      if (get().accountId !== accountId) {
        epoch++;
        requests.clear();
        catalogRequest = undefined;
        cachedCatalog = undefined;
        invalidations.clear();
        catalogLoadedAt = null;
        retryAfter = 0;
        set(emptyState());
      }
      const saved = get().bySpace[spaceId];
      set({
        accountId,
        spaceId,
        installations: saved ?? [],
        ready: !!saved,
        loading: false,
        error: "",
      });
      void get().load(accountId, false, spaceId);
    },
    async load(accountId, force = false, spaceId = get().spaceId) {
      if (!accountId) return;
      if (get().accountId !== accountId) {
        epoch++;
        requests.clear();
        catalogRequest = undefined;
        cachedCatalog = undefined;
        invalidations.clear();
        catalogLoadedAt = null;
        retryAfter = 0;
        set({ ...emptyState(), accountId, spaceId });
      }
      if (!force && get().bySpace[spaceId] && catalogLoadedAt !== null) return;
      if (Date.now() < retryAfter) return;
      const key = `${accountId}:${spaceId}`;
      const pending = requests.get(key);
      if (pending) return pending;
      const generation = readApiSessionGeneration(),
        ownEpoch = epoch;
      if (spaceId === get().spaceId) set({ loading: true });
      const request: Promise<void> = (async () => {
        try {
          const [catalog, installations] = await Promise.all([
            loadCatalog(),
            spaceId
              ? appsApi.installations(spaceId)
              : Promise.resolve({ apps: [] as Installation[] }),
          ]);
          assertIdentity(accountId, generation, ownEpoch);
          const incomingCatalog = catalog.apps.filter((app) => app.id !== "transfers");
          if (JSON.stringify(get().catalog) !== JSON.stringify(incomingCatalog))
            set({ catalog: incomingCatalog });
          accept(spaceId, installations.apps);
        } catch (error) {
          if (get().accountId === accountId && epoch === ownEpoch) {
            set((state) => {
              const bySpace = { ...state.bySpace };
              const accessLost =
                error instanceof ApiRequestError && [401, 403, 404].includes(error.status);
              if (error instanceof ApiRequestError && error.status === 429)
                retryAfter = Math.max(retryAfter, Date.now() + (error.retryAfterMs ?? 60_000));
              if (accessLost) delete bySpace[spaceId];
              const saved = accessLost ? [] : state.installations;
              return {
                bySpace,
                bySpaceErrors: { ...state.bySpaceErrors, [spaceId]: errorText(error) },
                ...(state.spaceId === spaceId
                  ? {
                      installations: saved,
                      ready: bySpace[spaceId] !== undefined,
                      loading: false,
                      error: errorText(error),
                    }
                  : {}),
              };
            });
          }
        } finally {
          if (epoch === ownEpoch) requests.delete(key);
        }
      })();
      requests.set(key, request);
      return request;
    },
    async invalidate(accountId, spaceId) {
      const key = `${accountId}:${spaceId}`;
      const queued = invalidations.get(key);
      if (queued) return queued;
      const ownEpoch = epoch;
      const pending = requests.get(key);
      const refresh = (async () => {
        if (pending) await pending;
        if (epoch === ownEpoch && get().accountId === accountId)
          await get().load(accountId, true, spaceId);
      })().finally(() => {
        if (invalidations.get(key) === refresh) invalidations.delete(key);
      });
      invalidations.set(key, refresh);
      return refresh;
    },
    async prefetchSpaceAccess(retryFailed = false) {
      const { accountId } = get();
      if (!accountId) return;
      await Promise.all(
        useSpacesStore.getState().spaces.map(({ id }) => {
          if (get().bySpace[id] || (!retryFailed && get().bySpaceErrors[id])) return;
          return get().load(accountId, false, id);
        }),
      );
    },
    adoptOnboarding(accountId, installations) {
      get().selectSpace(accountId, installations[0]?.space_id ?? "");
      if (installations[0]) accept(installations[0].space_id, installations);
    },
    setSpaceEnabled: (app, spaceId, enabled) =>
      change(
        app.id,
        (id) =>
          enabled
            ? appsApi.install(id, app.id, app.permission_version)
            : appsApi.uninstall(id, app.id),
        spaceId,
      ),
    install: (app) =>
      change(app.id, (spaceId) => appsApi.install(spaceId, app.id, app.permission_version)),
    uninstall: (appId) => change(appId, (spaceId) => appsApi.uninstall(spaceId, appId)),
    reorder: (appIds) => change("order", (spaceId) => appsApi.reorder(spaceId, appIds)),
    async setPinned(appId, pinned) {
      const { accountId, spaceId, installations } = get();
      if (!installations.some((app) => app.app_id === appId && app.state === "installed")) return;
      localStorage.setItem(pinKey(accountId, spaceId, appId), String(pinned));
      accept(spaceId, installations);
    },
    reset() {
      epoch++;
      catalogRequest = undefined;
      cachedCatalog = undefined;
      invalidations.clear();
      catalogLoadedAt = null;
      retryAfter = 0;
      requests.clear();
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
