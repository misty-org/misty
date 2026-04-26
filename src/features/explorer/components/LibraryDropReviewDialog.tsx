import { Button } from "@/ui";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { AlertTriangle, Files, Sparkles } from "lucide-react";
import type { SmartLibraryImportPreflight } from "@/models/interfaces/services/misty-api";

export function LibraryDropReviewDialog(props: {
  preflight: SmartLibraryImportPreflight;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { preflight } = props;
  const weeklyPercent = Math.min(100, Math.ceil(preflight.estimate.hostedAIWeeklyRatio * 100));
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onCancel();
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-charcoal-active text-cream-bright"
              aria-hidden="true"
            >
              <Sparkles size={18} />
            </span>
            <div className="grid gap-1.5">
              <AlertDialogTitle>Review files for Library</AlertDialogTitle>
              <AlertDialogDescription>
                Analysis starts only after confirmation. Original files remain in place.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <div className="grid grid-cols-2 divide-x divide-charcoal-border rounded-lg bg-charcoal-card text-sm">
          <div className="p-3">
            <Files className="mb-2 text-cream-muted" size={17} />
            <strong>{preflight.eligibleFiles}</strong>
            <span className="ml-1 text-cream-muted">eligible</span>
          </div>
          <div className="p-3">
            <Sparkles className="mb-2 text-cream-muted" size={17} />
            <strong>{weeklyPercent}%</strong>
            <span className="ml-1 text-cream-muted">weekly AI impact</span>
          </div>
        </div>
        {preflight.unsupportedFiles > 0 ? (
          <p className="m-0 flex items-center gap-2 rounded-md bg-sage-bg px-3 py-2 text-sm text-sage-fg">
            <AlertTriangle size={15} />
            {preflight.unsupportedFiles} unsupported file(s) will be skipped.
          </p>
        ) : null}
        <div
          className="max-h-32 overflow-auto rounded-md bg-charcoal-card px-3 py-2 text-xs text-cream-muted"
          data-explorer-scroll-container
        >
          {preflight.fileNames.map((name, index) => (
            <div className="truncate py-0.5" key={`${name}:${index}`}>
              {name}
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <Button variant="outline" type="button" disabled={props.busy} onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={props.busy || preflight.eligibleFiles === 0}
            onClick={props.onConfirm}
          >
            {props.busy ? "Starting…" : "Add and analyze"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
