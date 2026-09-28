import { useEffect, useRef } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useBrowserSyncStore } from "./store";
import { startPageStateCapture } from "./restore/capture";
import { restoreAfterSwitch } from "./restore/restorer";
import { hydrateTabHistories, startTabHistorySync } from "./restore/history";

/** Saves page state and tab histories while this device drives a workspace,
 * and restores tabs after it takes a workspace over from another device. */
export function PageStateBridge({ accountId }: { accountId: string }) {
  const driving = useBrowserSyncStore((state) =>
    state.session?.account_id === accountId && state.session.trees
      ? state.session.trees.driving_tree
      : undefined,
  );
  const current = useRef(driving);
  current.current = driving;
  useEffect(() => {
    if (!hasTauriInternals() || !accountId) return;
    const stopCapture = startPageStateCapture(() => Boolean(current.current));
    const stopHistory = startTabHistorySync(() => Boolean(current.current));
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
    void hydrateTabHistories(
      () => useBrowserSyncStore.getState().session?.trees?.driving_tree === seat,
    );
  }, [driving]);
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = driving;
    // Startup and first connection are not switches; a new seat is.
    if (!hasTauriInternals() || before === undefined || !driving || driving === before) return;
    return restoreAfterSwitch(
      () => useBrowserSyncStore.getState().session?.trees?.driving_tree === driving,
    );
  }, [driving]);
  return null;
}
