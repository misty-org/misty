import { cn } from "@/shared/ui/utils";
import { AlertCircle, RotateCcw } from "lucide-react";
import { SshHostKeyConfirmation } from "./SshHostKeyConfirmation";
import type { SshHostKeyStatus } from "./sshEnvironments";

export type TerminalSessionStatus =
  "starting" | "connecting" | "awaiting_fingerprint" | "running" | "exited" | "unavailable";

interface TerminalPaneOverlaysProps {
  status: TerminalSessionStatus;
  error: string;
  hostKey: SshHostKeyStatus | null;
  onCancelSsh?: () => void;
  onConfirmFingerprint: () => void;
  onRestart: () => void;
}

export function TerminalPaneOverlays(props: TerminalPaneOverlaysProps) {
  const { status, error, hostKey, onCancelSsh, onConfirmFingerprint, onRestart } = props;
  return (
    <>
      {status === "starting" || status === "connecting" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#111312]/70 text-xs text-cream-muted">
          {status === "connecting" ? "Verifying SSH environment…" : "Starting shell…"}
        </div>
      ) : null}
      {status === "awaiting_fingerprint" && hostKey ? (
        <SshHostKeyConfirmation
          status={hostKey}
          onCancel={() => onCancelSsh?.()}
          onConfirm={onConfirmFingerprint}
        />
      ) : null}
      {status === "unavailable" ? (
        <div className="absolute inset-0 grid place-items-center bg-[#111312] p-6">
          <div className="max-w-sm rounded-md border border-charcoal-border bg-charcoal-card p-4 text-center text-xs text-cream-muted">
            <AlertCircle className="mx-auto mb-2 text-cream-muted" size={20} />
            <p className="mb-3">{error || "The terminal session could not be started."}</p>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded border border-charcoal-border px-2 text-[11px] hover:bg-charcoal-hover"
              onClick={onRestart}
            >
              <RotateCcw size={11} /> Retry
            </button>
          </div>
        </div>
      ) : null}
      {status === "exited" ? (
        <button
          type="button"
          className={cn(
            "absolute bottom-3 right-3 inline-flex h-7 items-center gap-1.5 rounded",
            "border border-charcoal-border bg-charcoal-card px-2 text-[11px] text-cream",
            "hover:bg-charcoal-hover",
          )}
          onClick={onRestart}
        >
          <RotateCcw size={11} /> Reconnect
        </button>
      ) : null}
    </>
  );
}
