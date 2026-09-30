import { useEffect, useRef, useState } from "react";
import {
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useSettingsProfiles } from "@/features/settings/sync";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import {
  lockNativeSync,
  forgetNativeSyncKey,
  unlockNativeSync,
  vaultAvailability,
  type SyncAccount,
} from "./native";
import { selectSyncStatus } from "./syncStatus";
import { retrySync } from "./retrySync";
import { useBrowserSyncStore } from "./store";
import type { VaultUnlockRequest } from "./SyncVaultForm";

export function useSyncController(accountId: string, settingsOnly = false) {
  const sync = useBrowserSyncStore();
  const prefs = useSettingsProfiles();
  const recovery = useWorkspaceRecoveryState();
  const desktop = hasTauriInternals();
  const [online, setOnline] = useState(navigator.onLine);
  const [available, setAvailable] = useState<{
    account: SyncAccount;
    generation: number;
    local: boolean;
    remote: boolean | null;
  } | null>(null);
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const session = sync.session?.account_id === accountId ? sync.session : null;
  const reenroll = sync.reenroll === accountId;
  useEffect(() => {
    mounted.current = true;
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  useEffect(() => {
    setAvailable(null);
    setForm(false);
    setError(null);
    if (!desktop || !accountId || settingsOnly) return;
    let active = true;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    const check = async () => {
      try {
        const account = { apiBase: await resolveApiBase(), accountId };
        if (!valid()) return;
        setAvailable({ account, generation, local: false, remote: null });
        await readApiAuthToken();
        if (!valid()) return;
        const found = await vaultAvailability(account);
        if (valid()) setAvailable({ account, generation, ...found });
      } catch {
        if (valid())
          setError(
            "Could not check the sync vault. Retry sync, or enter your existing unlock details.",
          );
      }
    };
    void check();
    window.addEventListener("online", check);
    return () => {
      active = false;
      window.removeEventListener("online", check);
    };
  }, [accountId, desktop, settingsOnly, attempt]);
  const vault =
    available?.account.accountId === accountId &&
    available.generation === readApiSessionGeneration()
      ? available
      : null;
  const status = selectSyncStatus({
    accountId,
    session,
    operationError: error,
    issue: sync.session && !session ? null : sync.issue,
    connecting: sync.connecting,
    locked: sync.locked === accountId,
    reenroll,
    desktop,
    online,
    recovery,
    vault,
    scope: settingsOnly ? "settings" : "all",
    preferences: {
      accountId: prefs.accountId,
      ready: prefs.ready,
      syncing: prefs.syncing,
      error: prefs.error,
      pending: prefs.state?.outbox.length ?? 0,
      synced: !!prefs.state?.profile,
    },
  });
  const execute = async (work: (valid: () => boolean) => Promise<void>) => {
    if (pending.current || isApiSessionTransitioning()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const generation = readApiSessionGeneration();
    const valid = () =>
      mounted.current && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    try {
      await work(valid);
    } catch {
      if (valid())
        setError("Sync could not complete. Check your connection and unlock details, then retry.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const retry = () =>
    execute(async (valid) => {
      const result = await retrySync(accountId, status.action?.kind, settingsOnly || !desktop);
      if (!valid()) return;
      if (result === "sign-in") {
        window.location.assign("/signin");
        return;
      }
      if (result === "credentials" || result === "setup") {
        if (result === "credentials" && !reenroll)
          setAvailable((previous) => (previous ? { ...previous, local: false } : previous));
        setForm(true);
      } else if (result === "complete") {
        setForm(false);
        setAttempt((n) => n + 1);
      }
    });
  const unlock = async (request: VaultUnlockRequest) => {
    if (!vault || isApiSessionTransitioning() || vault.generation !== readApiSessionGeneration())
      throw new Error("Your account changed. Reopen sync.");
    const valid = () =>
      mounted.current &&
      !isApiSessionTransitioning() &&
      vault.generation === readApiSessionGeneration();
    await readApiAuthToken();
    if (!valid()) throw new Error("Your account changed. Reopen sync.");
    const opened = await unlockNativeSync(
      vault.account,
      request.password,
      request.syncSecret,
      request.remember,
      !reenroll && !vault.local && vault.remote === false,
      reenroll,
    );
    if (valid()) {
      useBrowserSyncStore.setState({ session: opened, issue: null, reenroll: null, locked: null });
      setError(null);
      setForm(false);
    }
  };
  const lock = (forget: boolean) =>
    execute(async (valid) => {
      if (session) await lockNativeSync(session.session_id, forget);
      else if (forget && vault) await forgetNativeSyncKey(vault.account);
      if (!valid()) return;
      useBrowserSyncStore.setState({ session: null, issue: null, locked: accountId });
      if (forget) setAvailable((previous) => (previous ? { ...previous, local: false } : previous));
      setForm(true);
    });
  return {
    accountId,
    session,
    desktop,
    status,
    busy,
    retry,
    vault,
    reenroll,
    form,
    setForm,
    unlock,
    lock,
  };
}
export type SyncController = ReturnType<typeof useSyncController>;
