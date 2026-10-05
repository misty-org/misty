import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
} from "@/shared/ui";
import { subscribeAccountEvents } from "@/api/accountEvents";
import { reportSystemError } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { RefreshCcw, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { pairingFailure } from "./pairingFailure";
import { PairingProgress } from "./PairingProgress";
import type { useConnectedDevices } from "./useConnectedDevices";

type Controller = ReturnType<typeof useConnectedDevices>;

export function ConnectedDevicePairingDialog({
  open,
  onOpenChange,
  controller,
  link,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: Controller;
  /** A pairing link opened from outside Misty; redeemed as soon as this device is ready. */
  link?: string;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [failureMessage, setFailureMessage] = useState("");
  const accountId = useAuth().user?.id ?? "";

  // The server publishes each pairing state change ("device-pairing"); expiry is
  // the one transition time alone causes, so it gets a single timer.
  const { refreshPairing } = controller;
  const pairingState = controller.pairing?.session.state;
  const pairingExpiresAt = controller.pairing?.session.expiresAt;
  useEffect(() => {
    if (!open || (pairingState !== "pending" && pairingState !== "redeemed")) return;
    const refresh = () => void refreshPairing().catch(() => {});
    const stop = subscribeAccountEvents(accountId, (event) => {
      if (event.topic === "device-pairing" || event.topic === "reset") refresh();
    });
    const untilExpiry = pairingExpiresAt ? Date.parse(pairingExpiresAt) - Date.now() : NaN;
    const expiry = Number.isFinite(untilExpiry)
      ? window.setTimeout(refresh, Math.max(0, untilExpiry) + 500)
      : undefined;
    return () => {
      stop();
      window.clearTimeout(expiry);
    };
  }, [accountId, refreshPairing, open, pairingExpiresAt, pairingState]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setFailureMessage("");
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      const failure = pairingFailure(cause);
      setFailureMessage(`${failure.title}. ${failure.description} ${failure.action}`);
      reportSystemError({
        title: failure.title,
        error: failure.description,
        scope: "files:device-pairing",
        target: { kind: "workspace-tool", tool: "files" },
      });
    } finally {
      setBusy(false);
    }
  }, []);

  // A link's secret is single-use, so each link is redeemed at most once. On
  // failure it stays in the field for a manual retry.
  const redeemedLink = useRef<string | null>(null);
  const { ready, redeemPairing } = controller;
  const hasPairing = Boolean(controller.pairing);
  useEffect(() => {
    if (!open || !link || !ready || hasPairing || redeemedLink.current === link) return;
    redeemedLink.current = link;
    setInput(link);
    void run(() => redeemPairing(link));
  }, [open, link, ready, hasPairing, redeemPairing, run]);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      controller.setPairing(null);
      setInput("");
      setFailureMessage("");
    }
  };

  const pairing = controller.pairing;
  const redeemingLink = Boolean(link) && busy && !pairing;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md border-charcoal-border bg-charcoal-card text-cream">
        {failureMessage ? (
          <p role="alert" className="text-sm text-cream-muted">
            {failureMessage}
          </p>
        ) : null}
        <DialogHeader>
          <DialogTitle>Connect another device</DialogTitle>
          <DialogDescription>
            Open Misty on the other device, then scan a code or enter one from that device. Both
            devices must use the same Misty account.
          </DialogDescription>
        </DialogHeader>

        {!controller.ready && !pairing ? (
          <div className="grid justify-items-center gap-3 py-7 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-charcoal-active text-cream-bright">
              {controller.loading ? <Spinner size="lg" label={false} /> : <Wifi size={19} />}
            </span>
            <div className="grid gap-1">
              <p className="font-medium text-cream">
                {controller.loading ? "Preparing device connections" : "Connection setup paused"}
              </p>
              <p className="max-w-sm text-sm text-cream-muted">
                {controller.error || "Misty is preparing this device for secure local sharing."}
              </p>
            </div>
            {!controller.loading ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run(controller.refresh)}
              >
                <RefreshCcw size={15} /> Try again
              </Button>
            ) : null}
          </div>
        ) : null}

        {pairing ? (
          <PairingProgress
            pairing={pairing}
            isCreator={pairing.session.creatorDeviceId === controller.localServerDeviceId}
            busy={busy}
            onConfirm={() => void run(controller.confirmPairing)}
            onStartOver={() => {
              controller.setPairing(null);
              setFailureMessage("");
            }}
            onDone={() => close(false)}
          />
        ) : null}

        {redeemingLink ? (
          <div className="grid justify-items-center gap-3 py-7 text-center">
            <Spinner size="lg" label={false} />
            <p className="font-medium text-cream">Connecting with the pairing link</p>
          </div>
        ) : null}

        {!pairing && controller.ready && !redeemingLink ? (
          <div className="grid gap-4">
            <Button disabled={busy} onClick={() => void run(controller.createPairing)}>
              Show a QR code
            </Button>
            <div className="flex items-center gap-3 text-xs text-cream-muted">
              <span className="h-px flex-1 bg-charcoal-border" /> or{" "}
              <span className="h-px flex-1 bg-charcoal-border" />
            </div>
            <div className="grid gap-2">
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="8-character code or pairing link"
                autoCapitalize="characters"
              />
              <Button
                variant="secondary"
                disabled={busy || input.trim().length < 8}
                onClick={() => void run(() => controller.redeemPairing(input))}
              >
                Connect with code
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
