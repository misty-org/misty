import { useEffect, useRef } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useBrowserSyncStore } from "./store";
import { startPageStateCapture } from "./restore/capture";
import { restoreAfterSwitch } from "./restore/restorer";
import { hydrateViewHistories, startViewHistorySync } from "./restore/history";

const shownWorkspace = () => {
  const state = useBrowserSyncStore.getState().session?.sync;
  return state ? (state.on_workspace ?? state.driving_workspace) : undefined;
};

/** Saves page state and tab histories for the workspace this machine is on,
 * and restores tabs after it opens another device's tabs. */
export function PageStateBridge({ accountId }: { accountId: string }) {
  const driving = useBrowserSyncStore((state) =>
    state.session?.account_id === accountId && state.session.sync
      ? (state.session.sync.on_workspace ?? state.session.sync.driving_workspace)
      : undefined,
  );
  const current = useRef(driving);
  current.current = driving;
  useEffect(() => {
    if (!hasTauriInternals() || !accountId) return;
    const stopCapture = startPageStateCapture(() => Boolean(current.current));
    const stopHistory = startViewHistorySync(() => Boolean(current.current));
    return () => {
      stopCapture();
      stopHistory();
    };
  }, [accountId]);
  // Any new seat, including the first one after startup, brings back tab
  // histories saved in that workspace.
  useEffect(() => {
    if (!hasTauriInternals() || !driving) return;
    const seat = driving;
    void hydrateViewHistories(() => shownWorkspace() === seat);
  }, [driving]);
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = driving;
    // Startup and first connection are not switches; a new seat is.
    if (!hasTauriInternals() || before === undefined || !driving || driving === before) return;
    return restoreAfterSwitch(() => shownWorkspace() === driving);
  }, [driving]);
  return null;
}
