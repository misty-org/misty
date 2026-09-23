import { useEffect, type ReactNode } from "react";
import { resolveApiBase } from "@/api/deployment/api";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { readNativeSync, unlockNativeSync, vaultAvailability } from "./native";
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
          if (existing.status.phase === "attention" || existing.status.phase === "stopped") {
            try {
              const restarted = await unlockNativeSync(account, null, null, false);
              if (valid()) useBrowserSyncStore.setState({ session: restarted, issue: null });
              return;
            } catch (error) {
              // The vault may not have been remembered. Keep the safe local
              // projection available and let Settings request its unlock details.
              if (valid())
                useBrowserSyncStore.setState({
                  session: null,
                  issue: error instanceof Error ? error.message : String(error),
                });
              return;
            }
          }
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
            // No remembered key is normal. Unlock remains available in Settings.
          }
        }
      } catch (error) {
        if (valid())
          useBrowserSyncStore.setState({
            issue: error instanceof Error ? error.message : String(error),
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [accountId, enabled]);
  return children;
}
