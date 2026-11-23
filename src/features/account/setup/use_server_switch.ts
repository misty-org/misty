import { relaunch } from "@/shared/platform/relaunch";
import { probeServer } from "@/api/deployment/probe";
import {
  currentApiBase,
  mistyCloudServer,
  saveServerChoice,
  useServerChoice,
  type ServerChoice,
} from "@/api/deployment/server_choice";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useAuth } from "../sessions/auth_state";
import { useCallback } from "react";

export function leavesServer(before: ServerChoice | null, next: ServerChoice): boolean {
  if (!before || before.mode === "none") return false;
  return next.mode === "none" || next.url !== before.url;
}

async function choose(next: ServerChoice) {
  const before = useServerChoice.getState().choice;
  await saveServerChoice(next);
  if (leavesServer(before, next) && hasTauriInternals()) await relaunch();
}

export function useServerSwitch() {
  const { user, accounts, logout, removeAccount } = useAuth();
  const leave = useCallback(async () => {
    if (user) await logout();
    for (const account of accounts) {
      if (account.id !== user?.id) await removeAccount(account.id).catch(() => undefined);
    }
  }, [user, accounts, logout, removeAccount]);

  const moveTo = useCallback(
    async (apiBase: string) => {
      if (currentApiBase() && currentApiBase() !== apiBase) await leave();
      await choose({ mode: "server", url: apiBase });
    },
    [leave],
  );

  const switchTo = useCallback(
    async (apiBase: string) => {
      if (!(await probeServer(apiBase))) return false;
      await moveTo(apiBase);
      return true;
    },
    [moveTo],
  );

  const switchToMistyCloud = useCallback(async () => {
    if (!(await switchTo(mistyCloudServer())))
      throw new Error("Misty couldn't reach Misty Cloud. Check your connection.");
  }, [switchTo]);

  return { moveTo, switchTo, switchToMistyCloud };
}
