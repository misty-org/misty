import { useEffect, type ReactNode } from "react";
import { resolveApiBase } from "@/api/deployment/api";
import {
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { readNativeSync, unlockNativeSync } from "./native";
import { useBrowserSyncStore } from "./store";

/** Best-effort background startup. Sync must never gate the signed-in app: a
 * missing vault, unavailable server, or browser-profile recovery remains visible
 * in Settings while the local workspace continues to work. */
export function BrowserSyncStartup({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const enabled = nativeWorkspaceRecoveryEnabled();
  useEffect(() => {
    if (!enabled || !accountId) return;
    let active = true;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const connect = async () => {
      if (!valid() || running) return;
      running = true;
      clearTimeout(timer);
      try {
        // Restore the native JWT cookie jar before asking sync to use it. This
        // is local credential loading, not a dependency on the /me request.
        await readApiAuthToken();
        if (!valid()) return;
        const account = { apiBase: await resolveApiBase(), accountId };
        if (!valid()) return;
        const existing = await readNativeSync();
        if (!valid()) return;
        if (
          existing?.account_id === accountId &&
          existing.deployment === new URL(account.apiBase).href.replace(/\/$/, "") &&
          existing.status.phase !== "attention" &&
          existing.status.phase !== "stopped"
        ) {
          // A live worker already owns network retries and JWT refresh.
          useBrowserSyncStore.setState({ session: existing, issue: null });
          failures = 0;
          return;
        }
        useBrowserSyncStore.setState({ connecting: true });
        // Try the saved client key directly, even without cached vault metadata.
        // Native code fetches any missing metadata and verifies the key.
        const opened = await unlockNativeSync(account, null, null, false);
        if (valid()) {
          failures = 0;
          useBrowserSyncStore.setState({ session: opened, issue: null });
        }
      } catch (error) {
        failures += 1;
        if (valid())
          useBrowserSyncStore.setState({
            session: null,
            issue: error instanceof Error ? error.message : String(error),
          });
      } finally {
        running = false;
        if (valid()) {
          useBrowserSyncStore.setState({ connecting: false });
          // Keep trying after startup failures and terminal worker exits. A
          // healthy worker is only inspected; it is never restarted by polling.
          timer = setTimeout(
            () => void connect(),
            failures ? Math.min(1_000 * 2 ** Math.min(failures, 5), 30_000) : 30_000,
          );
        }
      }
    };
    const retry = () => void connect();
    void connect();
    window.addEventListener("online", retry);
    return () => {
      active = false;
      useBrowserSyncStore.setState({ connecting: false });
      clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [accountId, enabled]);
  return children;
}
