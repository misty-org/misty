import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { DeviceChooseScreen } from "./DeviceChooseScreen";
import { claimNativeTree, readNativeSync } from "./native";
import { SeatCheckScreen } from "./SeatCheckScreen";
import { browserSyncRetryEvent, useBrowserSyncStore } from "./store";
import { mustChoose, seatUnconfirmed } from "./treeControl";

/** A reconnect normally confirms the seat within seconds; don't flash for blips. */
export const SEAT_CHECK_GRACE_MS = 60_000;

function useOverdue(active: boolean, ms: number) {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    setOverdue(false);
    if (!active) return;
    const timer = window.setTimeout(() => setOverdue(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && overdue;
}

/** Tree mode: a device without a seat pauses its webviews and asks which
 * workspace to continue with, instead of the legacy resting screen. A device
 * that cannot confirm its seat pauses too: one writer per workspace. */
export function DeviceChooseOverlay({ accountId }: { accountId: string }) {
  const session = useBrowserSyncStore((state) => state.session);
  const connecting = useBrowserSyncStore((state) => state.connecting);
  const [busyTree, setBusyTree] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const choosing = Boolean(
    hasTauriInternals() &&
    accountId &&
    session?.account_id === accountId &&
    session.full_sync !== false &&
    (session.status.phase === "ready" || session.status.phase === "catching_up") &&
    !session.status.issue &&
    mustChoose(session) &&
    !isApiSessionTransitioning(),
  );
  const unconfirmed = Boolean(
    hasTauriInternals() &&
    accountId &&
    session?.account_id === accountId &&
    session.full_sync !== false &&
    seatUnconfirmed(session) &&
    !isApiSessionTransitioning(),
  );
  // A stopped worker will never confirm the seat on its own.
  const stopped = session?.status.phase === "attention" || session?.status.phase === "stopped";
  const overdue = useOverdue(unconfirmed && !stopped, SEAT_CHECK_GRACE_MS);
  const checking = !choosing && unconfirmed && (stopped || overdue);
  useLayoutEffect(() => {
    if (!choosing && !checking) return;
    setBrowserWebviewsSuspended(true, "device-sync-choose");
    return () => setBrowserWebviewsSuspended(false, "device-sync-choose");
  }, [choosing, checking]);
  useEffect(() => {
    if (!choosing) {
      setBusyTree(null);
      setError(null);
    }
  }, [choosing]);
  useEffect(() => {
    if (!busyTree) return;
    const timer = window.setTimeout(() => {
      if (!mounted.current) return;
      setBusyTree(null);
      setError("That device didn't respond. Try again.");
    }, 35000);
    return () => window.clearTimeout(timer);
  }, [busyTree]);
  if (checking && session)
    return (
      <SeatCheckScreen
        session={session}
        retrying={connecting}
        onRetry={() =>
          window.dispatchEvent(new CustomEvent(browserSyncRetryEvent, { detail: accountId }))
        }
      />
    );
  if (!choosing || !session?.trees) return null;
  const choose = async (treeId: string) => {
    if (busyTree) return;
    setBusyTree(treeId);
    setError(null);
    const generation = readApiSessionGeneration();
    const valid = () =>
      mounted.current &&
      !isApiSessionTransitioning() &&
      generation === readApiSessionGeneration() &&
      useBrowserSyncStore.getState().session?.session_id === session.session_id;
    try {
      await claimNativeTree(session.session_id, treeId);
      const updated = await readNativeSync();
      if (valid() && updated) useBrowserSyncStore.setState({ session: updated });
    } catch (failure) {
      if (valid()) {
        setBusyTree(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    }
  };
  return (
    <DeviceChooseScreen
      session={session}
      trees={session.trees}
      busyTree={busyTree}
      error={error}
      onChoose={(treeId) => void choose(treeId)}
    />
  );
}
