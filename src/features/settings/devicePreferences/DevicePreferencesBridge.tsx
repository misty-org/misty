import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth";
import { useSettingsStore } from "../store/useSettingsStore";
import { useDevicePreferences } from "./store";
import { mutateState } from "./persistence";
import { useDockingLayoutStore } from "@/features/app-shell/dockingLayout";

// Settings were namespaced by deployment while self-hosting existed; Hosted is the one left.
const scope = "hosted";

export function DevicePreferencesBridge() {
  const { user, transitioning } = useAuth();
  const [retry, setRetry] = useState(0);
  const loaded = useSettingsStore((s) => s.loaded);
  const available = useSettingsStore((s) => s.settings !== null);
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
    const initialize = async () => {
      // A frozen installation baseline prevents a newly selected account from
      // importing the previous account's preferences.
      const seed = await mutateState<Record<string, unknown>>(
        `settings-baseline:${scope}`,
        () => {
          const document = useSettingsStore.getState().settings?.document ?? {};
          return {
            ...document,
            appearance: {
              ...((document.appearance as Record<string, unknown>) ?? {}),
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
      // Settings belong to this device, not to an account: they stay put when someone else
      // signs in, and they apply on the sign-in screen too.
      await useDevicePreferences.getState().configure(JSON.stringify([scope]), seed);
    };
    void initialize().catch((error) => useDevicePreferences.setState({ error: String(error) }));
    return () => {
      active = false;
      useDevicePreferences.getState().disconnect();
    };
    // Settings belong to the device, so the signed-in account's id is not a separate trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, available, transitioning, retry]);
  return null;
}
