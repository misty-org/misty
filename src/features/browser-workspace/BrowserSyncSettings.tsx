import { useEffect, useState } from "react";
import { resolveApiBase } from "@/api/deployment/api";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { useUserStore } from "@/features/auth";
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
} from "./native";
import { useBrowserSyncStore } from "./store";
import { SyncVaultForm } from "./SyncVaultForm";

function statusLabel(session: NativeSyncView) {
  if (session.status.issue) return "Needs attention";
  if (session.status.phase === "offline") return "Offline · edits queued on this device";
  if (session.status.phase === "connecting") return "Connecting";
  if (session.status.pending_changes)
    return `${session.status.pending_changes} changes waiting to sync`;
  if (session.status.applied_sequence < session.status.head_sequence)
    return "Receiving workspace changes";
  if (session.status.phase === "stopped" || session.status.phase === "attention")
    return "Needs attention";
  return "Workspace changes up to date";
}
export function BrowserSyncSettings() {
  const accountId = useUserStore((state) => state.me?.id);
  const session = useBrowserSyncStore((state) => state.session);
  const issue = useBrowserSyncStore((state) => state.issue);
  const [available, setAvailable] = useState<{
    account: SyncAccount;
    local: boolean;
    remote: boolean | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const native = hasTauriInternals();
  useEffect(() => {
    let active = true;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    setAvailable(null);
    setError(null);
    if (native && accountId)
      void (async () => {
        try {
          const account = { apiBase: await resolveApiBase(), accountId };
          if (!valid()) return;
          const found = await vaultAvailability(account);
          if (valid()) setAvailable({ account, ...found });
        } catch (failure) {
          if (valid()) setError(failure instanceof Error ? failure.message : String(failure));
        }
      })();
    return () => {
      active = false;
    };
  }, [accountId, native, attempt]);
  return (
    <div className="grid gap-6">
      <SettingsSection
        title="Device sync · Preview"
        description="Keep your tabs, splits and virtual windows in an encrypted workspace across devices."
      >
        <SettingsNote>
          Tabs, layouts and supported website storage sync automatically while your workspace is
          unlocked. Some websites may ask you to sign in again on a new device.
        </SettingsNote>
        {!native ? (
          <SettingsNote>Open the Misty desktop app to set up device sync.</SettingsNote>
        ) : !accountId ? (
          <SettingsNote>Sign in to Misty before setting up device sync.</SettingsNote>
        ) : session?.account_id === accountId ? (
          <>
            <SettingsRow label="Workspace status">
              <span role="status" className="text-sm text-cream-muted">
                {issue ? "Needs attention" : statusLabel(session)}
              </span>
            </SettingsRow>
            <SettingsRow label="Other devices online">
              <span className="text-sm text-cream-muted">
                {
                  session.presence.filter(
                    (device) => device.device_id !== session.device_id && device.online,
                  ).length
                }
              </span>
            </SettingsRow>
            {(issue || session.status.issue) && (
              <p role="alert" className="px-5 py-3 text-sm text-destructive">
                {issue ?? session.status.issue}
              </p>
            )}
            <SettingsRow label="Website data">
              <span role="status" className="text-sm text-cream-muted">
                {session.browser_profile_ready
                  ? "Automatic sync enabled"
                  : "Preparing website storage"}
              </span>
            </SettingsRow>
          </>
        ) : null}
        {error && (
          <div className="px-5 pb-4">
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        )}
        {native && accountId && !available && !error && !session && (
          <SettingsNote>Checking your sync vault…</SettingsNote>
        )}
      </SettingsSection>
      {available && session?.account_id !== accountId && (
        <SyncVaultForm
          key={`${available.account.apiBase}:${accountId}`}
          local={available.local}
          create={!available.local && available.remote === false}
          onGenerateSecret={generateSyncSecret}
          onUnlock={async ({ password, syncSecret, remember }) => {
            const generation = readApiSessionGeneration();
            if (isApiSessionTransitioning() || useUserStore.getState().me?.id !== accountId)
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
