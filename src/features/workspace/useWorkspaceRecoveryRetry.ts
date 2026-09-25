import { useEffect } from "react";
import {
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { nativeWorkspaceRecoveryEnabled } from "./workspaceRecoveryPlatform";
import {
  continueWithTemporaryWorkspace,
  restoreNativeWorkspace,
  useWorkspaceRecoveryState,
} from "./nativeWorkspaceRecovery";

export function useWorkspaceRecoveryRetry(accountId: string) {
  const usable = useWorkspaceRecoveryState(
    (state) => state.accountId === accountId && (state.usable || state.ready),
  );
  useEffect(() => {
    if (!accountId || !nativeWorkspaceRecoveryEnabled() || usable) return;
    const generation = readApiSessionGeneration();
    const timer = setTimeout(() => {
      if (!isApiSessionTransitioning() && generation === readApiSessionGeneration())
        continueWithTemporaryWorkspace(
          accountId,
          new Error("Local workspace recovery is taking longer than expected."),
        );
    }, 3000);
    return () => clearTimeout(timer);
  }, [accountId, usable]);
  const needsRecovery = useWorkspaceRecoveryState(
    (state) => state.accountId === accountId && Boolean(state.issue),
  );
  useEffect(() => {
    if (!accountId || !nativeWorkspaceRecoveryEnabled() || !needsRecovery) return;
    let active = true;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && generation === readApiSessionGeneration();
    const retry = async () => {
      if (!valid() || running) return;
      running = true;
      clearTimeout(timer);
      try {
        await retryWorkspaceRecovery(accountId, valid);
      } finally {
        running = false;
        if (valid() && useWorkspaceRecoveryState.getState().issue) {
          failures++;
          timer = setTimeout(
            () => void retry(),
            Math.min(2000 * 2 ** Math.min(failures, 4), 30000),
          );
        }
      }
    };
    const wake = () => {
      void retry();
    };
    timer = setTimeout(wake, 2000);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [accountId, needsRecovery]);
}

export async function retryWorkspaceRecovery(accountId: string, valid: () => boolean) {
  try {
    await readApiAuthToken();
    if (valid()) await restoreNativeWorkspace(accountId);
  } catch (error) {
    if (valid()) continueWithTemporaryWorkspace(accountId, error);
  }
}
