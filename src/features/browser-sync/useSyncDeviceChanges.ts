import { useEffect, useRef, useState } from "react";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import {
  claimNativeWorkspace,
  controlNativeDevice,
  readNativeSync,
  watchNativeSync,
  renameNativeDevice,
  type NativeSyncView,
} from "./native";
import { useBrowserSyncStore } from "./store";
import { onWorkspace } from "./workspaceControl";
import { captureBeforeSwitch, nativeCommandMs, withDeadline } from "./deadline";

type Pending = { deviceId: string; mode?: boolean; name?: string; started: number };

/**
 * The device roster's live session and its changes (rename, sync mode, opening a device's
 * tabs here). Each change waits until the device confirms it, or fails after a timeout.
 */
export function useSyncDeviceChanges(session: NativeSyncView) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const requesting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let reading = false;
    const generation = readApiSessionGeneration();
    const read = async () => {
      if (
        stopped ||
        reading ||
        isApiSessionTransitioning() ||
        generation !== readApiSessionGeneration()
      )
        return;
      reading = true;
      try {
        const latest = await withDeadline(readNativeSync(), nativeCommandMs);
        if (
          !stopped &&
          generation === readApiSessionGeneration() &&
          !isApiSessionTransitioning() &&
          latest?.session_id === session.session_id &&
          latest.account_id === session.account_id &&
          useBrowserSyncStore.getState().session?.session_id === session.session_id
        )
          useBrowserSyncStore.setState({ session: latest });
      } catch {
        /* The shared sync status reports connection health. */
      } finally {
        reading = false;
      }
    };
    void read();
    // The native session announces status, presence, device and workspace
    // changes; the slow pass only covers time-based expiry of activation requests.
    const stopWatching = watchNativeSync(() => void read());
    const timer = setInterval(() => void read(), 15_000);
    return () => {
      stopped = true;
      mounted.current = false;
      clearInterval(timer);
      void stopWatching.then((stop) => stop());
    };
  }, [session.session_id, session.account_id]);
  useEffect(() => {
    if (!pending) return;
    const device = session.devices?.find((d) => d.device_id === pending.deviceId);
    const confirmed =
      pending.name !== undefined
        ? device?.display_name === pending.name
        : pending.mode !== undefined
          ? device?.full_sync === pending.mode
          : onWorkspace(session) === pending.deviceId;
    if (confirmed) {
      setPending(null);
      setEditing(null);
      return;
    }
    const timer = setTimeout(
      () => {
        setPending(null);
        setError(
          "The device did not confirm the change. Check its connection and try the action again.",
        );
      },
      Math.max(0, 35000 - (Date.now() - pending.started)),
    );
    return () => clearTimeout(timer);
  }, [pending, session]);
  const change = async (request: Omit<Pending, "started">) => {
    if (pending || requesting.current || isApiSessionTransitioning()) return;
    requesting.current = true;
    setPending({ ...request, started: Date.now() });
    setError(null);
    const generation = readApiSessionGeneration();
    const valid = () =>
      mounted.current &&
      !isApiSessionTransitioning() &&
      generation === readApiSessionGeneration() &&
      useBrowserSyncStore.getState().session?.session_id === session.session_id;
    try {
      if (request.name !== undefined)
        await withDeadline(
          renameNativeDevice(session.session_id, request.deviceId, request.name),
          nativeCommandMs,
        );
      else if (request.mode !== undefined)
        await withDeadline(
          controlNativeDevice(session.session_id, request.deviceId, request.mode, false),
          nativeCommandMs,
        );
      else {
        // Part A3 owns replacement of the native exclusive claim contract. Keep
        // existing native safety overlays until that backend migration lands.
        await captureBeforeSwitch();
        if (!valid()) return;
        await withDeadline(
          claimNativeWorkspace(session.session_id, request.deviceId),
          nativeCommandMs,
        );
      }
      if (!valid()) return;
      const latest = await withDeadline(readNativeSync(), nativeCommandMs);
      if (
        valid() &&
        latest?.session_id === session.session_id &&
        latest.account_id === session.account_id
      )
        useBrowserSyncStore.setState({ session: latest });
    } catch {
      if (valid()) {
        setPending(null);
        setError("Could not update this device. Check its connection and try the action again.");
      }
    } finally {
      requesting.current = false;
    }
  };
  return { editing, setEditing, pending, error, change };
}
