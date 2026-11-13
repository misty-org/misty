import { relaunch } from "@/shared/platform/relaunch";
import { probeServer } from "@/api/deployment/probe";
import {
  currentApiBase,
  mistyCloudServer,
  saveServerChoice,
  useServerChoice,
  type ServerChoice,
} from "@/api/deployment/serverChoice";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useAuth } from "../sessions/authState";
import { useCallback } from "react";

/** Whether going from `before` to `next` leaves a server the device was using. */
export function leavesServer(before: ServerChoice | null, next: ServerChoice): boolean {
  if (!before || before.mode === "none") return false;
  return next.mode === "none" || next.url !== before.url;
}

/** Saves the choice, and restarts the app when it leaves a server in use: a device talks to one
 * server at a time, and every window and background job starts over on the new one. */
async function choose(next: ServerChoice) {
  const before = useServerChoice.getState().choice;
  await saveServerChoice(next);
  if (leavesServer(before, next) && hasTauriInternals()) await relaunch();
}

/**
 * Moves this device to another Misty server, or to none. Accounts belong to their server, so
 * leaving one signs out of it, forgets its saved accounts and restarts the app.
 */
export function useServerSwitch() {
  const { user, accounts, logout, removeAccount } = useAuth();
  const leave = useCallback(async () => {
    if (user) await logout();
    for (const account of accounts) {
      if (account.id !== user?.id) await removeAccount(account.id).catch(() => undefined);
    }
  }, [user, accounts, logout, removeAccount]);

  /** Makes it this device's server, leaving the current one. */
  const moveTo = useCallback(
    async (apiBase: string) => {
      if (currentApiBase() && currentApiBase() !== apiBase) await leave();
      await choose({ mode: "server", url: apiBase });
    },
    [leave],
  );

  /** Checks the server answers, then moves to it. False when it doesn't. */
  const switchTo = useCallback(
    async (apiBase: string) => {
      if (!(await probeServer(apiBase))) return false;
      await moveTo(apiBase);
      return true;
    },
    [moveTo],
  );

  /** Moves to Misty Cloud's server, or says why it can't. */
  const switchToMistyCloud = useCallback(async () => {
    if (!(await switchTo(mistyCloudServer())))
      throw new Error("Misty couldn't reach Misty Cloud. Check your connection.");
  }, [switchTo]);

  /** No server: signed out, with no Spaces. */
  const chooseNoServer = useCallback(async () => {
    if (currentApiBase()) await leave();
    await choose({ mode: "none" });
  }, [leave]);

  return { moveTo, switchTo, switchToMistyCloud, chooseNoServer };
}
