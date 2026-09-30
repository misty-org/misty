import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth";
import { readDeploymentScope } from "@/api/deployment/api";
import { observeAccountChanges } from "@/api/accountEvents";
import { useSettingsStore } from "../store/useSettingsStore";
import { useSettingsProfiles } from "./store";
import { readNavigatorLayout } from "@/features/app-shell";
import { mutateState } from "./persistence";
import { useDockingLayoutStore } from "@/features/app-shell/dockingLayout";

export function SettingsProfilesBridge() {
  const { user, transitioning } = useAuth();
  const [retry, setRetry] = useState(0);
  const loaded = useSettingsStore((s) => s.loaded);
  const available = useSettingsStore((s) => s.settings !== null);
  const scope = readDeploymentScope();
  useEffect(() => {
    const retryInitialization = () => setRetry((value) => value + 1);
    window.addEventListener("misty:retry-settings", retryInitialization);
    return () => window.removeEventListener("misty:retry-settings", retryInitialization);
  }, []);
  useEffect(() => {
    if (!useSettingsStore.getState().loaded) void useSettingsStore.getState().load();
  }, []);
  useEffect(() => {
    if (!loaded || !available || transitioning) return;
    let active = true;
    let stop: (() => void) | undefined;
    let recovery: ReturnType<typeof setInterval> | undefined;
    const initialize = async () => {
      // A frozen installation baseline prevents a newly selected account from
      // importing the previous account's projected profile preferences.
      const seed = await mutateState<Record<string, unknown>>(
        `settings-baseline:${scope}`,
        () => {
          const document = useSettingsStore.getState().settings?.document ?? {};
          return {
            ...document,
            appearance: {
              ...((document.appearance as Record<string, unknown>) ?? {}),
              navigator_auto_hide: readNavigatorLayout().autoHide,
              saved_layouts_json: JSON.stringify(useDockingLayoutStore.getState().savedLayouts),
            },
          };
        },
        (s) => {
          // Extend an older frozen baseline only with previously separate installation caches.
          const document = useSettingsStore.getState().settings?.document ?? {};
          const shortcuts = (s.shortcuts ?? {}) as Record<string, unknown>;
          const appearance = (s.appearance ?? {}) as Record<string, unknown>;
          return {
            ...s,
            shortcuts: {
              ...shortcuts,
              overrides_json:
                shortcuts.overrides_json ??
                (document.shortcuts as Record<string, unknown> | undefined)?.overrides_json ??
                "[]",
            },
            appearance: {
              ...appearance,
              saved_layouts_json:
                appearance.saved_layouts_json ??
                JSON.stringify(useDockingLayoutStore.getState().savedLayouts),
            },
          };
        },
      );
      if (!active) return;
      const accountId = user?.id ?? "";
      // The legacy companion cache is already account-scoped.
      try {
        const companion = JSON.parse(
          localStorage.getItem(`misty.cursor-companion:${accountId}`) || "null",
        );
        if (companion) seed.companion = companion;
      } catch {
        /* Use defaults for corrupt legacy preferences. */
      }
      await useSettingsProfiles
        .getState()
        .configure(JSON.stringify([scope, accountId]), accountId, seed);
      if (!active || !useSettingsProfiles.getState().ready) return;
      recovery = setInterval(() => {
        const profiles = useSettingsProfiles.getState();
        if (navigator.onLine && profiles.accountId) void profiles.refresh().catch(() => {});
      }, 30_000);
      stop = observeAccountChanges(accountId, ["settings-profiles"], () =>
        useSettingsProfiles.getState().refresh(),
      );
    };
    void initialize().catch((error) => useSettingsProfiles.setState({ error: String(error) }));
    return () => {
      active = false;
      stop?.();
      clearInterval(recovery);
      useSettingsProfiles.getState().disconnect();
    };
  }, [loaded, available, transitioning, user?.id, scope, retry]);
  return null;
}
