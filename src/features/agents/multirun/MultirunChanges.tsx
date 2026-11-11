import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Skeleton } from "@/shared/ui";
import { diffSteps, type DiffStep } from "../context-panel/diffSteps";
import "../context-panel/contextPanel.css";
import { errorText, multirunApi, type LaneFile } from "./multirunApi";
import { changeTotals } from "./multirunLogic";

const statusWords: Record<LaneFile["status"], string> = {
  modified: "Modified",
  added: "New",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "New",
};

/**
 * What a lane changed since the multi-run started, read again a moment after `stamp` changes
 * (the lane's agent used a tool, or finished). `null` until the first read comes back.
 */
export function useLaneChanges(multirun: string, lane: number, stamp: unknown) {
  const [files, setFiles] = useState<LaneFile[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void multirunApi
        .changes(multirun, lane)
        .then((read) => live && (setFiles(read), setError("")))
        .catch((reason) => live && (setFiles([]), setError(errorText(reason))));
    }, 600);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [multirun, lane, stamp]);
  return { files, error };
}

function Step({ step }: { step: DiffStep }) {
  return (
    <div className="context-diff">
      {step.heading ? <div className="context-diff-heading">{step.heading}</div> : null}
      {step.lines.map((line, index) => (
        <div key={index} className="context-diff-line" data-kind={line.kind}>
          <span className="context-diff-sign" aria-hidden="true">
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
          </span>
          <span className="sr-only">
            {line.kind === "added" ? "Added: " : line.kind === "removed" ? "Removed: " : ""}
          </span>
          <span className="whitespace-pre-wrap break-all">{line.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

function FileRow({ file }: { file: LaneFile }) {
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => (open ? diffSteps(file.patch) : []), [open, file.patch]);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <Pressable className="multirun-file" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Chevron size={14} className="flex-none text-cream-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={file.path}>
          {file.path}
        </span>
        <span className="context-status" data-status={file.status}>
          {statusWords[file.status]}
        </span>
        <span className="multirun-count" data-kind="added">
          +{file.insertions}
        </span>
        <span className="multirun-count" data-kind="removed">
          −{file.deletions}
        </span>
      </Pressable>
      {open ? (
        steps.length ? (
          steps.map((step, index) => <Step key={index} step={step} />)
        ) : (
          <p className="px-4 pb-2 text-xs text-cream-muted">Nothing to show for this file.</p>
        )
      ) : null}
    </>
  );
}

/** A lane's changes against where the multi-run started: a line of totals, then each file's diff. */
export function MultirunChanges({ files, error }: { files: LaneFile[] | null; error: string }) {
  const totals = useMemo(() => changeTotals(files ?? []), [files]);
  return (
    <section className="multirun-changes context-panel" aria-label="Changes">
      <div className="multirun-changes-head">
        <span className="flex-1 font-medium">Changes</span>
        {files?.length ? (
          <>
            <span className="multirun-count" data-kind="added">
              +{totals.insertions}
            </span>
            <span className="multirun-count" data-kind="removed">
              −{totals.deletions}
            </span>
            <span>
              {totals.files} {totals.files === 1 ? "file" : "files"}
            </span>
          </>
        ) : null}
      </div>
      <div className="multirun-changes-list">
        {!files ? (
          <div className="grid gap-2 px-4 py-1" aria-hidden="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : error ? (
          <p className="px-4 py-1 text-sm text-cream-muted">{error}</p>
        ) : !files.length ? (
          <p className="px-4 py-1 text-sm text-cream-muted">No changes yet.</p>
        ) : (
          files.map((file) => <FileRow key={file.path} file={file} />)
        )}
      </div>
    </section>
  );
}
