import { useEffect, useState } from "react";
import { resolveApiBase } from "@/api/deployment/api";
import {
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { useAuth } from "@/features/auth";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSection,
} from "@/features/settings/desktop";
import { SettingsNote } from "@/features/settings/settingsControls";
import {
  generateSyncSecret,
  unlockNativeSync,
  vaultAvailability,
  type NativeSyncView,
  type SyncAccount,
  activeDeviceEpoch,
} from "./native";
import { useBrowserSyncStore } from "./store";
import { SyncVaultForm } from "./SyncVaultForm";

function statusLabel(session: NativeSyncView) {
  if (session.status.issue) return "Needs attention";
  if (session.status.phase === "offline")
    return activeDeviceEpoch(session)
      ? "Offline · edits queued on this device"
      : "Offline · waiting to receive changes";
  if (session.status.phase === "connecting") return "Connecting";
  if (session.status.pending_changes)
    return `${session.status.pending_changes} changes waiting to sync`;
  if (session.status.applied_sequence < session.status.head_sequence)
    return "Receiving workspace changes";
  if (session.status.phase === "stopped" || session.status.phase === "attention")
    return "Needs attention";
  return "Workspace changes up to date";
}
function websiteDataLabel(session: NativeSyncView, issue: string | null) {
  if (session.supports_cookie_handoff === false) return "Not supported on this device";
  if (issue || session.status.issue || session.browser_profile_issue) return "Needs attention";
  if (session.status.phase === "offline" || session.status.phase === "connecting")
    return "Waiting for sync connection";
  if (session.status.phase === "stopped" || session.status.phase === "attention")
    return "Needs attention";
  if (!activeDeviceEpoch(session))
    return session.workspace.active_device?.device_id
      ? "Receiving from the active device"
      : "Waiting for an active device";
  if (session.browser_profile_ready) return "Automatic sync enabled";
  if (session.status.applied_sequence < session.status.head_sequence)
    return "Waiting for workspace changes";
  if (session.status.pending_changes > 0) return "Waiting for changes to finish syncing";
  if (session.workspace.records.length === 0) return "Waiting for workspace data";
  return "Preparing website storage";
}

export function BrowserSyncSettings() {
  const { user, transitioning } = useAuth();
  const accountId = user?.id;
  const connecting = useBrowserSyncStore((state) => state.connecting);
  const session = useBrowserSyncStore((state) => state.session);
  const issue = useBrowserSyncStore((state) => state.issue);
  const [available, setAvailable] = useState<{
    account: SyncAccount;
    generation: number;
    local: boolean;
    remote: boolean | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const native = hasTauriInternals();
  useEffect(() => {
    let active = true;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    setAvailable(null);
    setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checking = false;
    const check = async () => {
      if (!native || !accountId || transitioning || !valid() || checking) return;
      checking = true;
      clearTimeout(timer);
      try {
        await readApiAuthToken();
        if (!valid()) return;
        const account = { apiBase: await resolveApiBase(), accountId };
        if (!valid()) return;
        const found = await vaultAvailability(account);
        if (valid()) {
          setAvailable({ account, generation, ...found });
          setError(null);
        }
      } catch (failure) {
        if (valid()) setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        checking = false;
        if (valid()) timer = setTimeout(() => void check(), 30_000);
      }
    };
    const retry = () => {
      clearTimeout(timer);
      void check();
    };
    void check();
    window.addEventListener("online", retry);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [accountId, native, attempt, transitioning]);
  const reconnect = async () => {
    if (!accountId || reconnecting || transitioning) return;
    const generation = readApiSessionGeneration();
    const valid = () => !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    setReconnecting(true);
    setError(null);
    try {
      await readApiAuthToken();
      const account = { apiBase: await resolveApiBase(), accountId };
      if (!valid()) return;
      const opened = await unlockNativeSync(account, null, null, false);
      if (valid()) useBrowserSyncStore.setState({ session: opened, issue: null });
    } catch (failure) {
      if (!valid()) return;
      // Opening stops the terminal worker before trying the remembered key. If
      // no key was saved, expose the normal unlock form without blocking the app.
      useBrowserSyncStore.setState({ session: null, issue: null });
      setError(failure instanceof Error ? failure.message : String(failure));
      setAttempt((value) => value + 1);
    } finally {
      setReconnecting(false);
    }
  };
  return (
    <div className="grid gap-6">
      <SettingsSection
        title="Device sync · Preview"
        description="Keep your tabs, splits and virtual windows in an encrypted workspace across devices."
      >
        <SettingsNote>
          Sync runs in the background and reconnects automatically. Some websites may ask you to
          sign in again on a new device.
        </SettingsNote>
        {!native ? (
          <SettingsNote>Open the Misty desktop app to set up device sync.</SettingsNote>
        ) : !accountId ? (
          <SettingsNote>Sign in to Misty before setting up device sync.</SettingsNote>
        ) : session?.account_id === accountId ? (
          <>
            <SettingsRow label="Active device">
              <span className="text-sm text-cream-muted">
                {activeDeviceEpoch(session) ? "This device" : "Wake Misty to use this device"}
              </span>
            </SettingsRow>
            <SettingsRow label="Workspace status">
              <span role="status" className="text-sm text-cream-muted">
                {issue ? "Needs attention" : statusLabel(session)}
              </span>
            </SettingsRow>
            <SettingsRow label="Other devices online">
              <span className="text-sm text-cream-muted">
                {session.status.phase === "ready" || session.status.phase === "catching_up"
                  ? session.presence.filter(
                      (device) => device.device_id !== session.device_id && device.online,
                    ).length
                  : "Waiting for sync connection"}
              </span>
            </SettingsRow>
            {(issue || session.status.issue) && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <p role="alert" className="text-sm text-destructive">
                  {issue ?? session.status.issue}
                </p>
                <Button variant="outline" disabled={reconnecting} onClick={() => void reconnect()}>
                  {reconnecting ? "Reconnecting…" : "Reconnect"}
                </Button>
              </div>
            )}
            <SettingsRow label="Website data">
              <span role="status" className="text-sm text-cream-muted">
                {websiteDataLabel(session, issue)}
              </span>
            </SettingsRow>
            {session.browser_profile_issue && (
              <p role="alert" className="px-5 py-3 text-sm text-destructive">
                {session.browser_profile_issue}
              </p>
            )}
          </>
        ) : null}
        {(error || issue) && session?.account_id !== accountId && (
          <div className="px-5 pb-4">
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error ?? issue}
            </p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        )}
        {native && accountId && session?.account_id !== accountId && (
          <SettingsNote>
            {connecting
              ? "Connecting in the background…"
              : "Sync retries automatically when a connection is available."}
          </SettingsNote>
        )}
      </SettingsSection>
      {available &&
        available.account.accountId === accountId &&
        !transitioning &&
        session?.account_id !== accountId && (
          <SyncVaultForm
            key={`${available.account.apiBase}:${accountId}`}
            local={available.local}
            create={!available.local && available.remote === false}
            onGenerateSecret={generateSyncSecret}
            onUnlock={async ({ password, syncSecret, remember }) => {
              const generation = available.generation;
              if (isApiSessionTransitioning() || readApiSessionGeneration() !== generation)
                throw new Error("Your account changed. Reopen sync settings.");
              const opened = await unlockNativeSync(
                available.account,
                password,
                syncSecret,
                remember,
                !available.local && available.remote === false,
              );
              if (!isApiSessionTransitioning() && generation === readApiSessionGeneration())
                useBrowserSyncStore.setState({ session: opened, issue: null });
            }}
          />
        )}
    </div>
  );
}
