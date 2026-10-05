import type { PairingView } from "./connectedDeviceModel";
import { Button } from "@/shared/ui";
import { Check, TimerOff } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const panel = "grid gap-3 rounded-lg border border-charcoal-border p-4 text-center";

/** One view per pairing state, for whichever side of the pairing this device is on. */
export function PairingProgress({
  pairing,
  isCreator,
  busy,
  onConfirm,
  onStartOver,
  onDone,
}: {
  pairing: PairingView;
  isCreator: boolean;
  busy: boolean;
  onConfirm: () => void;
  onStartOver: () => void;
  onDone: () => void;
}) {
  const { session } = pairing;
  const otherName = isCreator
    ? session.requesterName || "the new device"
    : session.creatorName || "the other device";

  if (session.state === "pending" && pairing.deepLink) {
    return (
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
    );
  }

  if (session.state === "redeemed" && isCreator) {
    return (
      <div className="grid gap-3 rounded-lg border border-charcoal-border bg-charcoal-sidebar p-4">
        <div>
          <p className="font-medium">{session.requesterName || "New device"}</p>
          <p className="text-sm text-cream-muted">Confirm the same fingerprint appears there.</p>
        </div>
        <div className="rounded-md bg-charcoal-card px-3 py-2 text-center font-mono text-xl tracking-[0.2em]">
          {pairing.fingerprint}
        </div>
        <Button disabled={busy} onClick={onConfirm}>
          Confirm connection
        </Button>
      </div>
    );
  }

  if (session.state === "pending" || session.state === "redeemed") {
    return (
      <div className={panel}>
        <p className="font-medium">Waiting for confirmation on {session.creatorName}</p>
        {pairing.fingerprint ? (
          <p className="font-mono text-xl tracking-[0.2em]">{pairing.fingerprint}</p>
        ) : null}
      </div>
    );
  }

  if (session.state === "confirmed") {
    return (
      <div className={panel}>
        <span className="mx-auto grid size-10 place-items-center rounded-full bg-charcoal-active text-cream-bright">
          <Check size={18} />
        </span>
        <div className="grid gap-1">
          <p className="font-medium">Connected to {otherName}</p>
          <p className="text-sm text-cream-muted">It appears under Network in Files.</p>
        </div>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  }

  const locked = session.state === "locked";
  return (
    <div className={panel}>
      <span className="mx-auto grid size-10 place-items-center rounded-full bg-charcoal-active text-cream-bright">
        <TimerOff size={18} />
      </span>
      <div className="grid gap-1">
        <p className="font-medium">{locked ? "Too many attempts" : "Code expired"}</p>
        <p className="text-sm text-cream-muted">
          {locked
            ? "This pairing was locked after too many incorrect codes."
            : "Pairing codes last five minutes."}{" "}
          Start a new pairing to try again.
        </p>
      </div>
      <Button variant="secondary" onClick={onStartOver}>
        Start over
      </Button>
    </div>
  );
}
