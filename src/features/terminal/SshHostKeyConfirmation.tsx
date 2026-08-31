import type { SshHostKeyStatus } from "./sshEnvironments";

export function SshHostKeyConfirmation(props: {
  status: SshHostKeyStatus;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#111312] p-6">
      <div className="max-w-lg rounded-md border border-charcoal-border bg-charcoal-card p-4 text-xs text-cream-muted">
        <h2 className="mb-2 text-sm font-medium text-cream">Confirm SSH host</h2>
        <p className="mb-3">{props.status.message}</p>
        <code className="mb-4 block select-all break-all rounded bg-charcoal-workspace p-2 text-cream">
          {props.status.fingerprints[0]}
        </code>
        <p className="mb-4 text-[11px]">
          Compare this fingerprint with the server administrator before trusting it.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-7 rounded border border-charcoal-border px-2 hover:bg-charcoal-hover"
            onClick={props.onCancel}
          >
            Use local shell
          </button>
          <button
            type="button"
            className="h-7 rounded bg-cream px-2 text-charcoal-workspace hover:opacity-90"
            onClick={props.onConfirm}
          >
            Trust and connect
          </button>
        </div>
      </div>
    </div>
  );
}
