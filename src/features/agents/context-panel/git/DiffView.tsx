// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChoiceGroup, IconButton, Pressable, Skeleton, Tooltip } from "@/shared/ui";
import { absoluteOf, openChangedFile } from "./ChangesFileContextMenu";
import { diffSteps, type DiffStep } from "./diffSteps";
import {
  gitApi,
  gitErrorText,
  IMAGE_FILE_RE,
  type GitFileEntry,
  type GitImageDiff,
  type GitStatus,
} from "./gitApi";
import type { DiffTarget } from "./store";

const DIFF_TRUNCATE_LINES = 2000;
const DIFF_VIRTUALIZE_LINES = 500;

interface AnnotatedLine {
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** Gives each line its old and new line number from the `@@` hunk headers. */
export function annotateDiff(lines: string[]): AnnotatedLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { text, oldNo: null, newNo: null };
    }
    if (!inHunk) return { text, oldNo: null, newNo: null };
    if (text.startsWith("+")) return { text, oldNo: null, newNo: newLine++ };
    if (text.startsWith("-")) return { text, oldNo: oldLine++, newNo: null };
    return { text, oldNo: oldLine++, newNo: newLine++ };
  });
}

/** What kind of line it is; the `+++` and `---` file headers aren't additions or removals. */
export function diffLineKind(text: string): "add" | "del" | "hunk" | null {
  if (text.startsWith("+") && !text.startsWith("+++")) return "add";
  if (text.startsWith("-") && !text.startsWith("---")) return "del";
  if (text.startsWith("@@")) return "hunk";
  return null;
}

/** The status row of the file shown: from the staged list, else the unstaged or untracked one. */
function findStatusEntry(status: GitStatus | undefined, target: DiffTarget) {
  return target.staged
    ? status?.staged.find((entry) => entry.path === target.file)
    : (status?.unstaged.find((entry) => entry.path === target.file) ??
        status?.untracked.find((entry) => entry.path === target.file));
}

/** Changes when the file's own row does, so a refresh of other files doesn't read it again. */
function entrySignature(entry: GitFileEntry | undefined) {
  return entry ? `${entry.status}:${entry.additions ?? ""}:${entry.deletions ?? ""}` : "";
}

const lineSkeletons = (
  <div className="grid gap-2 p-3" aria-hidden="true">
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
    <Skeleton className="h-4 w-2/3" />
  </div>
);

/**
 * One file's diff, with line numbers; or, for a long one, one hunk at a time. An image shows
 * as its before and after.
 */
export function DiffView(props: {
  workspacePath: string;
  target: DiffTarget;
  status: GitStatus | undefined;
  onBack: () => void;
}) {
  const { workspacePath, target } = props;
  const [diffText, setDiffText] = useState<string | null>(null);
  const [imageDiff, setImageDiff] = useState<GitImageDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "steps">("all");
  const [at, setAt] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isImage = IMAGE_FILE_RE.test(target.file);
  const entry = findStatusEntry(props.status, target);
  const entrySig = entrySignature(entry);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // A patch says nothing useful about an image, so both versions are read instead.
    const work = isImage
      ? gitApi
          .diffImages(workspacePath, target.file, target.staged)
          .then((sides) => !cancelled && setImageDiff(sides))
      : gitApi
          .diff(workspacePath, target.file, target.staged)
          .then((text) => !cancelled && setDiffText(text));
    work.catch((reason: unknown) => !cancelled && setError(gitErrorText(reason)));
    return () => {
      cancelled = true;
    };
  }, [workspacePath, target.file, target.staged, entrySig, isImage]);

  const { lines, truncated } = useMemo(() => {
    if (diffText === null) return { lines: null, truncated: false };
    const all = diffText.split("\n");
    const over = all.length > DIFF_TRUNCATE_LINES;
    return {
      lines: annotateDiff(over ? all.slice(0, DIFF_TRUNCATE_LINES) : all),
      truncated: over,
    };
  }, [diffText]);
  const steps = useMemo(() => (diffText === null ? null : diffSteps(diffText)), [diffText]);
  const virtualize = lines !== null && lines.length > DIFF_VIRTUALIZE_LINES;
  const rowVirtualizer = useVirtualizer({
    count: virtualize && lines ? lines.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });
  const stepping = view === "steps" && steps !== null && steps.length > 1;
  const step = steps?.[Math.min(at, (steps?.length ?? 1) - 1)];

  return (
    <div className="git-panel">
      <div className="git-diff-head">
        <IconButton label="Back to changes" size="sm" onClick={props.onBack}>
          <ArrowLeft />
        </IconButton>
        <Tooltip content={target.file}>
          <span className="git-diff-path">{target.file}</span>
        </Tooltip>
        <span>{target.staged ? "Staged" : "Unstaged"}</span>
        {!isImage && steps && steps.length > 1 ? (
          <ChoiceGroup
            label="How to read these changes"
            size="sm"
            value={view}
            options={[
              { value: "all", label: "All" },
              { value: "steps", label: "Step by step" },
            ]}
            onChange={setView}
          />
        ) : null}
        {entry?.status !== "deleted" ? (
          <IconButton
            label="Open file"
            size="sm"
            onClick={() => openChangedFile(absoluteOf(workspacePath, target.file))}
          >
            <FileText />
          </IconButton>
        ) : null}
      </div>
      {isImage ? (
        <ImageDiffBody file={target.file} sides={imageDiff} error={error} />
      ) : (
        <div ref={scrollRef} className="git-diff-body">
          {error ? (
            <div className="git-empty" data-error>
              <p role="alert">{error}</p>
            </div>
          ) : lines === null ? (
            lineSkeletons
          ) : stepping && step ? (
            <StepBody step={step} />
          ) : (
            <DiffContent lines={lines} virtualize={virtualize} rowVirtualizer={rowVirtualizer} />
          )}
          {truncated && lines !== null && !stepping ? (
            <p className="git-diff-truncated">This diff is too long to show whole.</p>
          ) : null}
        </div>
      )}
      {stepping && steps ? (
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
    </div>
  );
}

/** One hunk on its own, for reading a long change a step at a time. */
function StepBody({ step }: { step: DiffStep }) {
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

function DiffContent(props: {
  lines: AnnotatedLine[];
  virtualize: boolean;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
}) {
  const { lines, rowVirtualizer } = props;
  if (!lines.some((line) => line.text)) {
    return (
      <div className="git-empty">
        <p>Nothing to show for this file.</p>
      </div>
    );
  }
  if (props.virtualize) {
    return (
      <div className="git-diff-lines">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
              }}
            >
              <DiffLine line={lines[row.index]} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="git-diff-lines">
      {lines.map((line, index) => (
        <DiffLine key={index} line={line} />
      ))}
    </div>
  );
}

const DiffLine = memo(function DiffLine({ line }: { line: AnnotatedLine }) {
  const kind = diffLineKind(line.text);
  return (
    <div className="git-diff-line" data-kind={kind ?? undefined}>
      <span className="git-diff-number">{line.oldNo ?? ""}</span>
      <span className="git-diff-number">{line.newNo ?? ""}</span>
      <span className="sr-only">
        {kind === "add" ? "Added: " : kind === "del" ? "Removed: " : ""}
      </span>
      <span className="git-diff-text">{line.text.length > 0 ? line.text : " "}</span>
    </div>
  );
});

/** The image before and after. A side that doesn't exist in a version is left out, so a new
 * image shows one pane rather than an empty comparison. Clicking one shows it at full size. */
function ImageDiffBody(props: { file: string; sides: GitImageDiff | null; error: string | null }) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  if (props.error) {
    return (
      <div className="git-empty" data-error>
        <p role="alert">{props.error}</p>
      </div>
    );
  }
  if (props.sides === null) {
    return (
      <div className="git-images" aria-hidden="true">
        <Skeleton className="h-full min-h-32 flex-1" />
      </div>
    );
  }
  const both = props.sides.old !== null && props.sides.new !== null;
  const panes: { key: string; label: string; src: string }[] = [];
  if (props.sides.old !== null) {
    panes.push({ key: "old", label: both ? "Before" : "Deleted", src: props.sides.old });
  }
  if (props.sides.new !== null) {
    panes.push({ key: "new", label: both ? "After" : "New", src: props.sides.new });
  }
  if (!panes.length) {
    return (
      <div className="git-empty">
        <p>No changes</p>
      </div>
    );
  }
  return (
    <div className="git-images">
      {panes
        .filter((pane) => zoomed === null || zoomed === pane.key)
        .map((pane) => (
          <figure key={pane.key} className="git-image m-0">
            <figcaption className="git-image-label">{pane.label}</figcaption>
            <div className="git-image-frame" data-zoomed={zoomed === pane.key || undefined}>
              <Pressable
                aria-label={`${pane.label}: ${props.file}`}
                aria-pressed={zoomed === pane.key}
                onClick={() => setZoomed(zoomed === pane.key ? null : pane.key)}
              >
                <img src={pane.src} alt="" />
              </Pressable>
            </div>
          </figure>
        ))}
    </div>
  );
}
