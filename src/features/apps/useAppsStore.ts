import { assertAppsClosedForUpdate, reserveAppUpdate } from "./appUpdateSafety";
import { assertAppCompatible } from "./appCompatibility";
import { appsApi, type OfficialApp, type UserAppInstallation } from "@/api/apps";
import { errorText } from "@/shared/lib/format";
import { assertStableApiSession, readApiSessionGeneration } from "@/api/client";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { isNavigatorAppId, type NavigatorAppId } from "@/features/workspace/navigatorApps";
import { isNativeMobileBuild, isWebBuild } from "@/shared/platform/buildTarget";
import {
  finalizeOfficialDesktopPackageInstall,
  officialDesktopPackageReady,
  stageOfficialDesktopPackage,
  uninstallOfficialDesktopPackage,
} from "@/features/apps/desktop-package-runtime";

interface AppsState {
  accountId: string;
  catalog: OfficialApp[];
  installations: UserAppInstallation[];
  ready: boolean;
  loading: boolean;
  actionAppId: string;
  error: string;
  load: (accountId: string, force?: boolean) => Promise<void>;
  adoptOnboarding: (accountId: string, installations: UserAppInstallation[]) => void;
  install: (app: OfficialApp) => Promise<void>;
  setPinned: (appId: string, pinned: boolean) => Promise<void>;
  uninstall: (appId: string) => Promise<void>;
  reset: () => void;
}

function replaceInstallation(items: UserAppInstallation[], next: UserAppInstallation) {
  return [...items.filter((item) => item.app_id !== next.app_id), next].sort(
    (left, right) => left.pin_rank - right.pin_rank || left.app_id.localeCompare(right.app_id),
  );
}

export const useAppsStore = create<AppsState>((set, get) => {
  let epoch = 0;
  let loadSequence = 0;
  const beginAction = (appId: string) => {
    const accountId = get().accountId;
    const generation = readApiSessionGeneration();
    const ownEpoch = epoch;
    const assert = () => {
      assertStableApiSession(generation);
      if (!accountId || get().accountId !== accountId || ownEpoch !== epoch)
        throw new Error("The account changed. Reopen Discover to continue.");
    };
    assert();
    if (get().actionAppId) throw new Error("Wait for the current App change to finish.");
    set({ actionAppId: appId, error: "" });
    return {
      assert,
      current: () => {
        try {
          assert();
          return true;
        } catch {
          return false;
        }
      },
    };
  };
  return {
    accountId: "",
    catalog: [],
    installations: [],
    ready: false,
    loading: false,
    actionAppId: "",
    error: "",
    load: async (accountId, force = false) => {
      if (!accountId) return;
      const current = get();
      if (
        (current.loading && current.accountId === accountId) ||
        (!force && current.ready && current.accountId === accountId)
      )
        return;
      if (current.accountId !== accountId) epoch++;
      const sequence = ++loadSequence;
      const generation = readApiSessionGeneration();
      set({
        accountId,
        loading: true,
        error: "",
        ...(current.accountId === accountId
          ? {}
          : { ready: false, catalog: [], installations: [], actionAppId: "" }),
      });
      try {
        const [catalog, installations] = await Promise.all([
          appsApi.catalog(),
          appsApi.installations(),
        ]);
        if (get().accountId !== accountId || sequence !== loadSequence) return;
        assertStableApiSession(generation);
        set({
          catalog: catalog.apps.filter((app) => app.id !== "transfers"),
          installations: installations.apps,
          ready: true,
          loading: false,
        });
      } catch (error) {
        if (
          get().accountId !== accountId ||
          sequence !== loadSequence ||
          generation !== readApiSessionGeneration()
        )
          return;
        set({ error: errorText(error), loading: false });
      }
    },
    adoptOnboarding: (accountId, installations) => {
      epoch++;
      loadSequence++;
      set({ accountId, installations, ready: false, loading: false, actionAppId: "", error: "" });
    },
    install: async (app) => {
      assertAppCompatible(app);
      assertAppsClosedForUpdate(app.id);
      const action = beginAction(app.id);
      let alreadyLocal = false;
      let packageOperationId: string | null = null;
      let installation: UserAppInstallation | null = null;
      let releaseUpdate = () => {};
      try {
        releaseUpdate = reserveAppUpdate(app.id);
        const needsDesktopPackage =
          !isNativeMobileBuild && !isWebBuild && app.desktop.runtime === "downloaded";
        alreadyLocal = needsDesktopPackage ? await officialDesktopPackageReady(app) : false;
        action.assert();
        if (needsDesktopPackage && !alreadyLocal) {
          packageOperationId = await stageOfficialDesktopPackage(app);
          action.assert();
        }
        installation = await appsApi.install(app.id, app.permission_version);
        action.assert();
        await finalizeOfficialDesktopPackageInstall(app.id, packageOperationId, true);
        action.assert();
        set((state) => ({
          installations: replaceInstallation(state.installations, installation!),
          actionAppId: "",
        }));
      } catch (error) {
        if (!isNativeMobileBuild && !isWebBuild && !alreadyLocal && packageOperationId) {
          await finalizeOfficialDesktopPackageInstall(app.id, packageOperationId, false).catch(
            () => undefined,
          );
        }
        let message = errorText(error);
        if (
          action.current() &&
          error instanceof Error &&
          "code" in error &&
          error.code === "app_permissions_changed"
        ) {
          const sequence = ++loadSequence;
          try {
            const catalog = await appsApi.catalog();
            action.assert();
            if (sequence === loadSequence) {
              set({
                catalog: catalog.apps.filter((item) => item.id !== "transfers"),
                loading: false,
              });
              message =
                "This app’s permissions changed. Review the refreshed permissions, then choose Add or Approve update.";
            }
          } catch {
            if (action.current() && sequence === loadSequence) set({ loading: false });
          }
        }
        if (action.current())
          set((state) => ({
            actionAppId: "",
            error: message,
            // The account install may have succeeded even if local activation did
            // not. Reflect the server truth; opening the app will retry the signed
            // package download instead of presenting a false uninstalled state.
            ...(installation
              ? { installations: replaceInstallation(state.installations, installation) }
              : {}),
          }));
        throw error;
      } finally {
        releaseUpdate();
      }
    },
    setPinned: async (appId, pinned) => {
      const action = beginAction(appId);
      try {
        const installation = await appsApi.setPinned(appId, pinned);
        action.assert();
        set((state) => ({
          installations: replaceInstallation(state.installations, installation),
          actionAppId: "",
        }));
      } catch (error) {
        if (action.current()) set({ actionAppId: "", error: errorText(error) });
        throw error;
      }
    },
    uninstall: async (appId) => {
      assertAppsClosedForUpdate(appId);
      const action = beginAction(appId);
      let releaseUpdate = () => {};
      try {
        releaseUpdate = reserveAppUpdate(appId);
        const installation = await appsApi.uninstall(appId);
        action.assert();
        set((state) => ({
          installations: replaceInstallation(state.installations, installation),
        }));
        if (!isNativeMobileBuild && !isWebBuild)
          await uninstallOfficialDesktopPackage(appId, action.assert);
        action.assert();
        set({ actionAppId: "" });
      } catch (error) {
        if (action.current()) set({ actionAppId: "", error: errorText(error) });
        throw error;
      } finally {
        releaseUpdate();
      }
    },
    reset: () => {
      epoch++;
      loadSequence++;
      set({
        accountId: "",
        catalog: [],
        installations: [],
        ready: false,
        loading: false,
        actionAppId: "",
        error: "",
      });
    },
  };
});

export function installedAppIds(installations: UserAppInstallation[]): string[] {
  return installations.filter((item) => item.state === "installed").map((item) => item.app_id);
}

export function pinnedAppIds(installations: UserAppInstallation[]): string[] {
  return installations
    .filter((item) => item.state === "installed" && item.pinned)
    .sort((left, right) => left.pin_rank - right.pin_rank)
    .map((item) => item.app_id);
}

export function navigatorAppIdForOfficialApp(appId: string): NavigatorAppId | null {
  if (appId === "chat") return "social";
  return isNavigatorAppId(appId) ? appId : null;
}

function navigatorIds(installations: UserAppInstallation[], pinnedOnly: boolean) {
  return installations
    .filter((item) => item.state === "installed" && (!pinnedOnly || item.pinned))
    .sort((left, right) => left.pin_rank - right.pin_rank)
    .flatMap((item) => {
      const id = navigatorAppIdForOfficialApp(item.app_id);
      return id ? [id] : [];
    });
}

export function useInstalledNavigatorAppIds(): NavigatorAppId[] {
  return useAppsStore(useShallow((state) => navigatorIds(state.installations, false)));
}

export function usePinnedNavigatorAppIds(): NavigatorAppId[] {
  return useAppsStore(useShallow((state) => navigatorIds(state.installations, true)));
}

export function officialAppIdForNavigator(appId: NavigatorAppId): string {
  return appId === "social" ? "chat" : appId;
}
