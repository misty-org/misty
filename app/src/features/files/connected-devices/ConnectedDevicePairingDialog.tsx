import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { ManagedAiRequestError } from "@/features/agents";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import type { useConnectedDevices } from "./useConnectedDevices";

type Controller = ReturnType<typeof useConnectedDevices>;

interface PairingFailure {
  title: string;
  description: string;
  action: string;
}

export function ConnectedDevicePairingDialog({
  open,
  onOpenChange,
  controller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: Controller;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PairingFailure | null>(null);

  useEffect(() => {
    const state = controller.pairing?.session.state;
    if (!open || (state !== "pending" && state !== "redeemed")) return;
    const timer = window.setInterval(() => void controller.refreshPairing().catch(() => {}), 1500);
    return () => window.clearInterval(timer);
  }, [controller, open]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(pairingFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const pairing = controller.pairing;
  const redeemed = pairing?.session.state === "redeemed";
  const canConfirm = redeemed && pairing.session.creatorDeviceId === controller.localServerDeviceId;
  const confirmed = pairing?.session.state === "confirmed";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) {
            controller.setPairing(null);
            setInput("");
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-md border-charcoal-border bg-charcoal-card text-cream">
          <DialogHeader>
            <DialogTitle>Connect another device</DialogTitle>
            <DialogDescription>
              Both devices must be signed into the same Misty account. The code expires after five
              minutes.
            </DialogDescription>
          </DialogHeader>

          {pairing?.deepLink ? (
            <div className="grid justify-items-center gap-4 py-2">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={pairing.deepLink} size={184} level="M" />
              </div>
              <div className="text-center">
                <p className="text-xs text-cream-muted">Or enter this code on the other device</p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.25em] text-cream">
                  {pairing.manualCode}
                </p>
              </div>
            </div>
          ) : null}

          {canConfirm ? (
            <div className="grid gap-3 rounded-lg border border-charcoal-border bg-charcoal-sidebar p-4">
              <div>
                <p className="font-medium">{pairing.session.requesterName || "New device"}</p>
                <p className="text-sm text-cream-muted">
                  Confirm the same fingerprint appears there.
                </p>
              </div>
              <div className="rounded-md bg-charcoal-card px-3 py-2 text-center font-mono text-xl tracking-[0.2em]">
                {pairing.fingerprint}
              </div>
              <Button disabled={busy} onClick={() => void run(controller.confirmPairing)}>
                Confirm connection
              </Button>
            </div>
          ) : null}

          {redeemed && !canConfirm ? (
            <div className="grid gap-3 rounded-lg border border-charcoal-border p-4 text-center">
              <p className="font-medium">
                Waiting for confirmation on {pairing.session.creatorName}
              </p>
              <p className="font-mono text-xl tracking-[0.2em]">{pairing.fingerprint}</p>
            </div>
          ) : null}

          {confirmed ? (
            <div className="rounded-lg border border-charcoal-border p-4 text-center">
              <p className="font-medium">Device connected</p>
            </div>
          ) : null}

          {!pairing ? (
            <div className="grid gap-4">
              <Button disabled={busy} onClick={() => void run(controller.createPairing)}>
                Show a QR code
              </Button>
              <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-cream-muted">
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

          {pairing && !redeemed && !confirmed && !pairing.deepLink ? (
            <div className="grid gap-3 rounded-lg border border-charcoal-border p-4 text-center">
              <p className="font-medium">
                Waiting for confirmation on {pairing.session.creatorName}
              </p>
              <p className="font-mono text-xl tracking-[0.2em]">{pairing.fingerprint}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={error !== null}
        onOpenChange={(next) => {
          if (!next) setError(null);
        }}
      >
        <AlertDialogContent className="border-charcoal-border bg-charcoal-card text-cream">
          <AlertDialogHeader>
            <AlertDialogTitle>{error?.title}</AlertDialogTitle>
            <AlertDialogDescription>{error?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setError(null)}>{error?.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function pairingFailure(cause: unknown): PairingFailure {
  const code = cause instanceof ManagedAiRequestError ? cause.code : undefined;
  if (code === "pairing_not_found") {
    return {
      title: "Code not found",
      description:
        "That pairing code is incorrect or no longer active. Check the code on the other device and try again.",
      action: "Try again",
    };
  }
  if (code === "pairing_expired") {
    return {
      title: "Code expired",
      description:
        "Pairing codes expire after five minutes. Generate a new code on the other device and try again.",
      action: "Try again",
    };
  }
  if (code === "pairing_locked") {
    return {
      title: "Too many attempts",
      description:
        "That pairing session was locked after too many incorrect attempts. Generate a new code and try again.",
      action: "Got it",
    };
  }
  if (code === "invalid_pairing_state") {
    return {
      title: "Pairing changed",
      description:
        "That pairing request is no longer waiting for this device. Start a new pairing.",
      action: "Got it",
    };
  }
  const message = cause instanceof Error ? cause.message.trim() : "";
  const safeMessage =
    message && !message.startsWith("{") && message !== "invalid request"
      ? message
      : "Check the pairing code and your connection, then try again.";
  return {
    title: "Couldn’t connect this device",
    description: safeMessage,
    action: "Try again",
  };
}
