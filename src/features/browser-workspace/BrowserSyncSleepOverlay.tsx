import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui/button";
import misty from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import mistyStill from "@/shared/assets/agents/cloud-sky-poster.webp?inline";
import { activateNativeDevice, activeDeviceEpoch, readNativeSync } from "./native";
import { useBrowserSyncStore } from "./store";

export function SyncSleepScreen({
  busy,
  error,
  onWake,
}: {
  busy: boolean;
  error: string | null;
  onWake: () => void;
}) {
  return (
    <Dialog.Root open modal={false}>
      <Dialog.Portal>
        <div
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 top-[38px] z-[2147483200] bg-black/75 backdrop-blur-sm"
        />
        <Dialog.Content
          data-slot="dialog-content"
          data-device-sync-sleep=""
          className="fixed inset-x-0 bottom-0 top-[38px] z-[2147483201] flex flex-col items-center justify-center overflow-y-auto p-8 text-center text-cream outline-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="none"
            type="button"
            aria-label="Wake Misty and use this device"
            aria-busy={busy}
            disabled={busy}
            onClick={onWake}
            className="group mb-6 rounded-full p-3 outline-none transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-8 focus-visible:ring-offset-transparent disabled:cursor-wait disabled:opacity-100 motion-reduce:transform-none"
          >
            <picture>
              <source media="(prefers-reduced-motion: reduce)" srcSet={mistyStill} />
              <img
                src={misty}
                alt=""
                width={176}
                height={176}
                draggable={false}
                className="size-44 select-none object-contain"
              />
            </picture>
          </Button>
          <Dialog.Title className="text-xl font-medium tracking-tight">
            Misty’s resting here
          </Dialog.Title>
          <Dialog.Description className="mt-3 max-w-xs text-sm leading-relaxed text-cream-muted">
            Your workspace is following along.
            <br />
            Click Misty to continue on this device.
          </Dialog.Description>
          <div className="mt-6 min-h-10 max-w-sm text-sm" aria-live="polite">
            {error ? (
              <p role="alert" className="text-red-300">
                {error}
              </p>
            ) : busy ? (
              <p className="text-cream-muted">Waking up…</p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function BrowserSyncSleepOverlay({ accountId }: { accountId: string }) {
  const session = useBrowserSyncStore((state) => state.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ id: string; sessionId: string; sequence: number } | null>(null);
  const requesting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const sleeping = Boolean(
    hasTauriInternals() &&
    accountId &&
    session?.account_id === accountId &&
    session.full_sync !== false &&
    session.workspace.active_device?.device_id &&
    (session.status.phase === "ready" || session.status.phase === "catching_up") &&
    session.status.applied_sequence >= session.status.head_sequence &&
    !session.status.issue &&
    !session.browser_profile_issue &&
    !activeDeviceEpoch(session) &&
    !isApiSessionTransitioning(),
  );
  useLayoutEffect(() => {
    if (!sleeping) return;
    setBrowserWebviewsSuspended(true, "device-sync-sleep");
    return () => setBrowserWebviewsSuspended(false, "device-sync-sleep");
  }, [sleeping]);
  useEffect(() => {
    const claim = pending.current;
    if (!sleeping) {
      pending.current = null;
      setBusy(false);
      setError(null);
      return;
    }
    if (!claim) return;
    if (!session || session.session_id !== claim.sessionId || !sleeping) {
      pending.current = null;
      setBusy(false);
      setError(null);
    } else if (
      session.workspace.sequence > claim.sequence &&
      !session.pending_operation_ids.includes(claim.id)
    ) {
      pending.current = null;
      setBusy(false);
      setError("Another device woke up too. Click Misty to try again.");
    }
  }, [session, sleeping]);
  const wake = async () => {
    if (!session || !sleeping || busy || requesting.current) return;
    requesting.current = true;
    setBusy(true);
    setError(null);
    const generation = readApiSessionGeneration();
    const valid = () =>
      mounted.current &&
      !isApiSessionTransitioning() &&
      generation === readApiSessionGeneration() &&
      useBrowserSyncStore.getState().session?.session_id === session.session_id;
    try {
      const id = await activateNativeDevice(session.session_id);
      if (!valid()) return;
      pending.current = { id, sessionId: session.session_id, sequence: session.workspace.sequence };
      const updated = await readNativeSync();
      if (valid() && updated) useBrowserSyncStore.setState({ session: updated });
    } catch (failure) {
      if (valid()) {
        pending.current = null;
        setBusy(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      requesting.current = false;
      if (mounted.current && !valid()) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  if (!sleeping) return null;
  return <SyncSleepScreen busy={busy} error={error} onWake={() => void wake()} />;
}
