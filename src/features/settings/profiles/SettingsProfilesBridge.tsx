import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth";
import { readDeploymentScope } from "@/api/deployment/api";
import { observeAccountChanges } from "@/api/accountEvents";
import { useSettingsStore } from "../store/useSettingsStore";
import { useSettingsProfiles } from "./store";
import { readNavigatorLayout } from "@/features/app-shell";
import { mutateState } from "./persistence";

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
              navigator_auto_hide: readNavigatorLayout().visibility === "hidden",
            },
          };
        },
        (s) => s,
      );
      if (!active) return;
      const accountId = user?.id ?? "";
      await useSettingsProfiles
        .getState()
        .configure(JSON.stringify([scope, accountId]), accountId, seed);
      if (!active || !useSettingsProfiles.getState().ready) return;
      recovery = setInterval(() => {
        const profiles = useSettingsProfiles.getState();
        if (navigator.onLine && (profiles.error || profiles.state?.outbox.length))
          void profiles.refresh().catch(() => {});
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
