import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@/shared/ui";
import { AlertTriangle, BrainCircuit } from "lucide-react";

export function MediaIndexApprovalDialog(props: {
  estimate: {
    fileNames: string[];
    fileCount: number;
    remainingDurationMs: number;
    estimatedWeeklyPercent: number;
  };
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const minutes = props.estimate.remainingDurationMs / 60_000;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onCancel();
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-sage-bg text-sage-fg"
              aria-hidden="true"
            >
              <BrainCircuit size={18} />
            </span>
            <div className="grid gap-1.5">
              <AlertDialogTitle>
                Analyze {props.estimate.fileCount}{" "}
                {props.estimate.fileCount === 1 ? "file" : "files"}?
              </AlertDialogTitle>
              <AlertDialogDescription className="leading-6">
                About {minutes.toFixed(minutes < 10 ? 1 : 0)} minutes remain and may use up to{" "}
                <strong className="font-medium text-cream">
                  {props.estimate.estimatedWeeklyPercent}% of your weekly hosted AI usage
                </strong>
                . Failed analysis and infrastructure retries do not count.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <div className="max-h-28 overflow-auto rounded-md bg-charcoal-card px-3 py-2 text-xs text-cream-muted">
          {props.estimate.fileNames.map((name) => (
            <div key={name} className="truncate py-0.5">
              {name}
            </div>
          ))}
        </div>
        <p className="m-0 text-xs leading-5 text-cream-muted">
          Analysis continues while Misty is open and resumes from the last completed 30-second chunk
          after a restart.
        </p>
        <AlertDialogFooter>
          <Button variant="outline" type="button" disabled={props.pending} onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={props.pending} onClick={props.onConfirm}>
            {props.pending ? "Starting…" : "Confirm analysis"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MediaIndexRemovalDialog(props: {
  target: { kind: "asset"; name: string } | { kind: "device" };
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const all = props.target.kind === "device";
  const targetName = props.target.kind === "asset" ? props.target.name : "";
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onCancel();
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-charcoal-active text-cream-bright"
              aria-hidden="true"
            >
              <AlertTriangle size={18} />
            </span>
            <div className="grid gap-1.5">
              <AlertDialogTitle>
                {all
                  ? "Clear this device’s media index?"
                  : `Remove “${targetName}” from Media Search?`}
              </AlertDialogTitle>
              <AlertDialogDescription className="leading-6">
                Generated transcripts, scene metadata, and embeddings will be permanently deleted
                from the server. Your original files are untouched.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        {props.error ? (
          <p
            className="m-0 rounded-md bg-charcoal-active px-3 py-2 text-sm text-cream-bright"
            role="alert"
          >
            {props.error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button variant="outline" type="button" disabled={props.pending} onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            type="button"
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            {props.pending ? "Removing…" : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
