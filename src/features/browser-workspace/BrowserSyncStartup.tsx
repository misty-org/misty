import { useEffect, useState, type ReactNode } from "react";
import { resolveApiBase } from "@/api/deployment/api";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { Button } from "@/shared/ui";
import { LoadingScreen } from "@/shared/ui/loading-screen";
import { canProjectWorkspace } from "./controller";
import {
  generateSyncSecret,
  readNativeSync,
  unlockNativeSync,
  vaultAvailability,
  type SyncAccount,
} from "./native";
import { SyncVaultForm } from "./SyncVaultForm";
import { useBrowserSyncStore } from "./store";

/** Account login opens the vault here, before a fresh device opens website tabs.
 * Remembering is opt-in; an unsaved key is requested once on this device. */
export function BrowserSyncStartup({
  accountId,
  children,
  onSignOut,
}: {
  accountId: string;
  children: ReactNode;
  onSignOut(): Promise<void>;
}) {
  const enabled = nativeWorkspaceRecoveryEnabled();
  const session = useBrowserSyncStore((state) => state.session);
  const [available, setAvailable] = useState<{
    account: SyncAccount;
    local: boolean;
    create: boolean;
  } | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [localOnly, setLocalOnly] = useState(false);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    setAvailable(null);
    setIssue(null);
    void (async () => {
      try {
        const account = { apiBase: await resolveApiBase(), accountId };
        if (!valid()) return;
        const existing = await readNativeSync();
        if (!valid()) return;
        if (
          existing?.account_id === accountId &&
          existing.deployment === new URL(account.apiBase).href.replace(/\/$/, "")
        ) {
          useBrowserSyncStore.setState({ session: existing, issue: null });
          return;
        }
        const found = await vaultAvailability(account);
        if (!valid()) return;
        if (found.local) {
          try {
            const opened = await unlockNativeSync(account, null, null, false);
            if (valid()) useBrowserSyncStore.setState({ session: opened, issue: null });
            return;
          } catch {
            // No remembered key is normal. Never replace the vault on failure.
          }
        }
        if (!valid()) return;
        if (!found.local && found.remote === null)
          throw new Error("Connect to your Misty server to receive your workspace.");
        setAvailable({
          account,
          local: found.local,
          create: !found.local && found.remote === false,
        });
      } catch (error) {
        if (valid()) setIssue(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [accountId, enabled, attempt]);

  const current = session?.account_id === accountId ? session : null;
  const ready =
    !!current &&
    canProjectWorkspace(current) &&
    (!current.supports_cookie_handoff || current.browser_profile_ready === true);
  useEffect(() => {
    if (ready) setEntered(true);
  }, [ready]);
  if (
    !enabled ||
    entered ||
    localOnly ||
    (current &&
      canProjectWorkspace(current) &&
      (!current.supports_cookie_handoff || current.browser_profile_ready))
  )
    return children;
  const failure = issue ?? current?.status.issue;
  if (!available && !failure)
    return (
      <LoadingScreen
        fullScreen
        label={current ? "Receiving your workspace" : "Connecting your workspace"}
      />
    );
  return (
    <main className="h-screen overflow-y-auto bg-charcoal-bg p-6 text-cream">
      <div className="mx-auto grid w-full max-w-2xl gap-6 py-10">
        <header className="grid gap-2">
          <h1 className="text-2xl font-semibold">Your workspace, on this device</h1>
          <p className="text-sm text-cream-muted">
            Unlock once to bring your tabs and layout here. Remember the key to reconnect
            automatically next time.
          </p>
        </header>
        {failure && (
          <div className="grid gap-3">
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Reconnect
            </Button>
          </div>
        )}
        {available && !current && (
          <SyncVaultForm
            local={available.local}
            create={available.create}
            onGenerateSecret={generateSyncSecret}
            onUnlock={async ({ password, syncSecret, remember }) => {
              const generation = readApiSessionGeneration();
              if (isApiSessionTransitioning())
                throw new Error("Wait for your account to finish switching.");
              const opened = await unlockNativeSync(
                available.account,
                password,
                syncSecret,
                remember,
                available.create,
              );
              if (!isApiSessionTransitioning() && generation === readApiSessionGeneration())
                useBrowserSyncStore.setState({ session: opened, issue: null });
            }}
          />
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" onClick={() => setLocalOnly(true)}>
            Use this device without sync
          </Button>
          <Button
            variant="ghost"
            onClick={() => void onSignOut().catch((error: unknown) => setIssue(String(error)))}
          >
            Choose another account
          </Button>
        </div>
      </div>
    </main>
  );
}
