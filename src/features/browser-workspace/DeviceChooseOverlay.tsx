import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { DeviceChooseScreen } from "./DeviceChooseScreen";
import { claimNativeTree, readNativeSync } from "./native";
import { useBrowserSyncStore } from "./store";
import { mustChoose } from "./treeControl";

/** Tree mode: a device without a seat pauses its webviews and asks which
 * workspace to continue with, instead of the legacy resting screen. */
export function DeviceChooseOverlay({ accountId }: { accountId: string }) {
  const session = useBrowserSyncStore((state) => state.session);
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
  useLayoutEffect(() => {
    if (!choosing) return;
    setBrowserWebviewsSuspended(true, "device-sync-choose");
    return () => setBrowserWebviewsSuspended(false, "device-sync-choose");
  }, [choosing]);
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
