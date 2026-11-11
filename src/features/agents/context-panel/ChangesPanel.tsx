import { ArrowLeft, ChevronLeft, ChevronRight, Minus, Plus, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  ErrorNotification,
  IconButton,
  Pressable,
  SegmentedControl,
  Skeleton,
  Textarea,
} from "@/shared/ui";
import { watchAllRunEvents } from "../runs/local-run/localRunEvents";
import { diffSteps, type DiffStep } from "./diffSteps";
import { errorText, projectApi, type GitChange, type GitStatus } from "./projectApi";

const statusWords: Record<GitChange["status"], string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "New",
};

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

/** One file's changes: all at once, or one step at a time for a change too long to take in. */
function FileChanges(props: { folder: string; change: GitChange; onBack(): void }) {
  const [steps, setSteps] = useState<DiffStep[] | null>(null);
  const [view, setView] = useState<"all" | "steps">("all");
  const [at, setAt] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void projectApi
      .gitDiff(props.folder, props.change)
      .then((patch) => live && setSteps(diffSteps(patch)))
      .catch((reason) => live && (setSteps([]), setError(errorText(reason))));
    return () => {
      live = false;
    };
  }, [props.folder, props.change]);
  const step = steps?.[Math.min(at, (steps?.length ?? 1) - 1)];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="context-subhead">
        <IconButton label="Back to changes" onClick={props.onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate" title={props.change.path}>
          {props.change.path}
        </span>
        {steps && steps.length > 1 ? (
          <SegmentedControl
            label="How to read these changes"
            size="xs"
            value={view}
            options={[
              { value: "all", label: "All" },
              { value: "steps", label: "Step by step" },
            ]}
            onChange={setView}
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!steps ? (
          <div className="grid gap-2 p-3" aria-hidden="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !steps.length ? (
          <p className="p-4 text-sm text-cream-muted">Nothing to show for this file.</p>
        ) : view === "steps" && step ? (
          <Step step={step} />
        ) : (
          steps.map((item, index) => <Step key={index} step={item} />)
        )}
      </div>
      {steps && view === "steps" && steps.length > 1 ? (
        <div className="context-foot">
          <IconButton label="Previous step" disabled={at <= 0} onClick={() => setAt(at - 1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <span className="text-xs text-cream-muted">
            Step {Math.min(at, steps.length - 1) + 1} of {steps.length}
          </span>
          <IconButton
            label="Next step"
            disabled={at >= steps.length - 1}
            onClick={() => setAt(at + 1)}
          >
            <ChevronRight size={16} />
          </IconButton>
        </div>
      ) : null}
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </div>
  );
}

function Group(props: {
  title: string;
  changes: GitChange[];
  action: "Stage" | "Unstage";
  onAct(change: GitChange): void;
  onOpen(change: GitChange): void;
}) {
  if (!props.changes.length) return null;
  const Icon = props.action === "Stage" ? Plus : Minus;
  return (
    <section>
      <h3 className="context-label">{props.title}</h3>
      {props.changes.map((change) => (
        <div key={`${change.staged}:${change.path}`} className="context-row-with-action">
          <Pressable type="button" className="context-row" onClick={() => props.onOpen(change)}>
            <span className="min-w-0 flex-1 truncate">{change.path}</span>
            <span className="context-status" data-status={change.status}>
              {statusWords[change.status]}
            </span>
          </Pressable>
          <IconButton label={`${props.action} ${change.path}`} onClick={() => props.onAct(change)}>
            <Icon size={15} />
          </IconButton>
        </div>
      ))}
    </section>
  );
}

/**
 * What changed in the folder, as Git sees it: staged and unstaged files, each file's diff, and a
 * commit of what is staged. It refreshes as agents work, since they are what changes the files.
 */
export function ChangesPanel({ folder }: { folder: string }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [open, setOpen] = useState<GitChange | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      projectApi
        .gitStatus(folder)
        .then(setStatus)
        .catch((reason) => setError(errorText(reason))),
    [folder],
  );
  useEffect(() => {
    setStatus(null);
    setOpen(null);
    void refresh();
    let timer: number | undefined;
    const stop = watchAllRunEvents((_run, event) => {
      if (!event.type.startsWith("tool.") && !event.type.startsWith("invocation.")) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 700);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [refresh]);
  const staged = useMemo(() => status?.changes.filter((c) => c.staged) ?? [], [status]);
  const unstaged = useMemo(() => status?.changes.filter((c) => !c.staged) ?? [], [status]);
  const act = (work: Promise<void>) => {
    setBusy(true);
    void work
      .then(refresh)
      .catch((reason) => setError(errorText(reason)))
      .finally(() => setBusy(false));
  };
  if (open) return <FileChanges folder={folder} change={open} onBack={() => setOpen(null)} />;
  if (!status)
    return (
      <div className="grid gap-2 p-3" aria-hidden={!error}>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <ErrorNotification message={error} onDismiss={() => setError("")} />
      </div>
    );
  if (!status.repository)
    return <p className="p-4 text-sm text-cream-muted">This folder isn't a Git repository.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="context-subhead">
        <span className="min-w-0 flex-1 truncate">{status.branch || "No branch"}</span>
        <IconButton label="Refresh changes" onClick={() => void refresh()}>
          <RotateCw size={15} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!status.changes.length ? (
          <p className="p-4 text-sm text-cream-muted">No changes.</p>
        ) : null}
        <Group
          title="Staged"
          changes={staged}
          action="Unstage"
          onOpen={setOpen}
          onAct={(change) => act(projectApi.gitStage(folder, [change.path], false))}
        />
        <Group
          title="Changes"
          changes={unstaged}
          action="Stage"
          onOpen={setOpen}
          onAct={(change) => act(projectApi.gitStage(folder, [change.path], true))}
        />
      </div>
      {staged.length ? (
        <div className="context-foot context-foot--stack">
          <Textarea
            aria-label="Commit message"
            className="min-h-16 resize-y"
            placeholder="Commit message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !message.trim()}
            onClick={() => act(projectApi.gitCommit(folder, message).then(() => setMessage("")))}
          >
            Commit
          </Button>
        </div>
      ) : null}
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </div>
  );
}
