import { useEffect, useState } from "react";
import { useAuth } from "./sessions/auth_state";
import { useSettingsStore } from "@/features/settings";
import { useDevicePreferences } from "@/features/settings";
import { mutateState } from "@/features/settings";
import { useDockingLayoutStore } from "@/app/shell/docking_layout";
import { writeDevicePreference } from "@/features/settings/preference_access";

const scope = "hosted";

function importLegacyCompanion(accountId: string) {
  const key = `misty.cursor-companion:${accountId}`;
  let saved: Record<string, unknown> | null = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    saved = JSON.parse(raw);
  } catch {}
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
      await useDevicePreferences.getState().configure(JSON.stringify([scope]), seed);
    };
    void initialize().catch((error) => useDevicePreferences.setState({ error: String(error) }));
    return () => {
      active = false;
      useDevicePreferences.getState().disconnect();
    };
  }, [loaded, available, transitioning, retry]);
  const accountId = user?.id;
  const ready = useDevicePreferences((s) => s.ready);
  useEffect(() => {
    if (accountId && ready) importLegacyCompanion(accountId);
  }, [accountId, ready]);
  return null;
}
