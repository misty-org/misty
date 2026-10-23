import { useEffect, useRef, useState } from "react";
import { openSignInSheet } from "@/features/auth";
import {
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { accountApi } from "@/api/account/api";
import {
  accountChangePassword,
  credentialEmail,
  deriveLoginCredential,
  isCredentialAccount,
  markCredentialAccount,
  passwordProblem,
  unmarkCredentialAccount,
  useAuth,
} from "@/features/auth";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import {
  lockNativeSync,
  deleteNativeSyncVault,
  forgetNativeSyncKey,
  resealSyncWithAccountPassword,
  unlockNativeSync,
  vaultAvailability,
  type SyncAccount,
} from "./native";
import { useSpacesStore } from "@/features/spaces/core";
import { selectSyncStatus } from "./syncStatus";
import { retrySync } from "./retrySync";
import { useBrowserSyncStore } from "./store";
import type { VaultUnlockRequest } from "./SyncVaultForm";

export function useSyncController(accountId: string) {
  const { user } = useAuth();
  // The keys are derived from the email the account was first seen with, as typed, and rebuilt
  // from that every time. The email the server reports can change, and would change the keys.
  const email = credentialEmail(accountId) ?? user?.email ?? "";
  // A Google account has no Misty password, so its sync password never touches the server.
  const [provider, setProvider] = useState<"misty" | "google">("misty");
  const sync = useBrowserSyncStore();
  const spaces = useSpacesStore((state) => state.spaces);
  const recovery = useWorkspaceRecoveryState();
  const desktop = hasTauriInternals();
  const [online, setOnline] = useState(navigator.onLine);
  const [available, setAvailable] = useState<{
    account: SyncAccount;
    generation: number;
    local: boolean;
    remote: boolean | null;
    /** True once the vault is sealed under the Misty password; false while it still needs a sync secret. */
    accountPassword: boolean | null;
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
    if (!hasTauriInternals() || !accountId) return;
    let active = true;
    void accountApi.me()
      .then((me) => {
        if (!active) return;
        setProvider(me.provider === "google" ? "google" : "misty");
        // The server says it has seen this password in plain form (a reset by email, on
        // another device or here): the account is no longer safe to seal a vault under.
        if (me.credential_account === false) unmarkCredentialAccount(accountId);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accountId]);
  useEffect(() => {
    setAvailable(null);
    setForm(false);
    setError(null);
    if (!desktop || !accountId) return;
    let active = true;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    const check = async () => {
      try {
        const account = { apiBase: await resolveApiBase(), accountId };
        if (!valid()) return;
        setAvailable({ account, generation, local: false, remote: null, accountPassword: null });
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
  }, [accountId, desktop, attempt]);
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
    spaceNames: Object.fromEntries(spaces.map((space) => [space.id, space.name])),
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
      const result = await retrySync(accountId, status.action?.kind, !desktop);
      if (!valid()) return;
      if (result === "sign-in") {
        openSignInSheet("expired");
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
      email,
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
  /** Throws so the confirmation can show what went wrong; nothing changes on failure. */
  const deleteVault = async (password: string) => {
    if (!vault || isApiSessionTransitioning() || vault.generation !== readApiSessionGeneration())
      throw new Error("Your account changed. Reopen sync.");
    await readApiAuthToken();
    // The password confirms it: the credential derived from it for an account that uses
    // them, as typed for one the server holds that way, nothing for an account with none.
    const confirmation =
      provider === "google"
        ? null
        : isCredentialAccount(accountId)
          ? await deriveLoginCredential(email, password)
          : password;
    try {
      await deleteNativeSyncVault(vault.account, confirmation);
    } catch (cause) {
      if (typeof cause === "string" && /password did not work/i.test(cause))
        throw new Error("That password did not work.");
      throw cause;
    }
    if (!mounted.current || vault.generation !== readApiSessionGeneration()) return;
    useBrowserSyncStore.setState({ session: null, issue: null, reenroll: null, locked: null });
    setAvailable((previous) =>
      previous ? { ...previous, local: false, remote: false } : previous,
    );
    setError(null);
    setForm(true);
  };
  /**
   * Chooses the Misty password the vault is sealed under; `current` is the old
   * one. The open vault is re-sealed first, which needs only its unlocked key,
   * then the server's password changes (it is sent only a derived credential), so
   * a failure on either step is retried with the same two passwords. A Google
   * account has no Misty password, so its sync password is local and needs no
   * `current`. The account counts as safe for new vaults only after both steps.
   */
  const changePassword = async (current: string, next: string) => {
    if (!vault || !email || isApiSessionTransitioning() || vault.generation !== readApiSessionGeneration())
      throw new Error("Your account changed. Reopen sync.");
    // A vault that exists must be open to be re-sealed; no vault yet needs nothing to open.
    if (!session && (vault.local || vault.remote === true))
      throw new Error("Unlock sync before changing your password.");
    if (current === next) throw new Error("Choose a password you have not used before.");
    const problem = await passwordProblem(email, next);
    if (problem) throw new Error(problem);
    if (session) await resealSyncWithAccountPassword(vault.account, email, next);
    if (provider !== "google") await accountChangePassword(email, current, next);
    markCredentialAccount(accountId, email);
    if (mounted.current) setAttempt((n) => n + 1);
  };
  return {
    accountId,
    email,
    provider,
    changePassword,
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
    deleteVault,
  };
}
export type SyncController = ReturnType<typeof useSyncController>;
