import { useEffect, useState } from "react";
import { useAuth } from "./sessions/authState";
import { useSettingsStore } from "@/features/settings";
import { useDevicePreferences } from "@/features/settings";
import { mutateState } from "@/features/settings";
import { useDockingLayoutStore } from "@/app/shell/dockingLayout";
import { writeDevicePreference } from "@/features/settings/preferenceAccess";

// Settings were namespaced by deployment while self-hosting existed; Hosted is the one left.
const scope = "hosted";

/**
 * Older builds kept the cursor companion's choices per account in the webview's storage. Once that
 * account is known here they move into this device's settings, filling only what is still unset,
 * and the old key goes.
 */
function importLegacyCompanion(accountId: string) {
  const key = `misty.cursor-companion:${accountId}`;
  let saved: Record<string, unknown> | null = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    saved = JSON.parse(raw);
  } catch {
    /* Corrupt legacy preferences are dropped. */
  }
  const values = useDevicePreferences.getState().state?.values;
  const legacy = [
    ["agents.companion.size", saved?.size, "number"],
    ["agents.companion.ask", saved?.ask, "boolean"],
    ["agents.companion.teach", saved?.teach, "boolean"],
  ] as const;
  const writes = legacy
    .filter(([id, value, type]) => typeof value === type && values?.[id] === undefined)
    .map(([id, value]) => writeDevicePreference(id, value as number | boolean));
  void Promise.all(writes)
    .then(() => localStorage.removeItem(key))
    .catch(() => undefined);
}

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
  }, [loaded, available, transitioning, retry]);
  const accountId = user?.id;
  const ready = useDevicePreferences((s) => s.ready);
  // Runs once someone is signed in and the settings are ready, not only at startup.
  useEffect(() => {
    if (accountId && ready) importLegacyCompanion(accountId);
  }, [accountId, ready]);
  return null;
}
