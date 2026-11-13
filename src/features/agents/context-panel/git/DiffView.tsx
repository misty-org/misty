// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ChoiceGroup,
  cn,
  IconButton,
  Pressable,
  Separator,
  Skeleton,
  SkeletonCode,
  Surface,
  Text,
  Tooltip,
  type TextTone,
} from "@/shared/ui";
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
/** The before and after of an image, side by side. */
const imagesClass = "flex min-h-0 flex-1 gap-2 p-2";
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

/**
 * The last diff read of each file this session, so opening one again shows it at once while it is
 * read again. Diffs can be long, so only a few are kept, in memory and never on disk.
 */
const shownDiffs = new Map<string, string>();
const MOST_SHOWN_DIFFS = 24;

function rememberDiff(key: string, text: string) {
  shownDiffs.delete(key);
  shownDiffs.set(key, text);
  if (shownDiffs.size > MOST_SHOWN_DIFFS) shownDiffs.delete(shownDiffs.keys().next().value!);
}

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
  const diffKey = `${workspacePath}\n${target.staged ? "staged" : "unstaged"}\n${target.file}`;
  // The diff shown belongs to the file shown: another file starts from its own last read.
  const [read, setRead] = useState(() => ({ key: diffKey, text: shownDiffs.get(diffKey) ?? null }));
  if (read.key !== diffKey) setRead({ key: diffKey, text: shownDiffs.get(diffKey) ?? null });
  const diffText = read.text;
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
      : gitApi.diff(workspacePath, target.file, target.staged).then((text) => {
          if (cancelled) return;
          rememberDiff(diffKey, text);
          setRead({ key: diffKey, text });
        });
    work.catch((reason: unknown) => !cancelled && setError(gitErrorText(reason)));
    return () => {
      cancelled = true;
    };
  }, [workspacePath, target.file, target.staged, entrySig, isImage, diffKey]);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <Text
        bare
        as="div"
        size="caption"
        tone="muted"
        className="flex min-h-9 min-w-0 flex-none items-center gap-1.5 px-2 py-0.5"
      >
        <IconButton label="Back to changes" onClick={props.onBack}>
          <ArrowLeft />
        </IconButton>
        <Tooltip content={target.file}>
          <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:var(--mask-fade-end)]">
            {target.file}
          </span>
        </Tooltip>
        <span>{target.staged ? "Staged" : "Unstaged"}</span>
        {!isImage && steps && steps.length > 1 ? (
          <ChoiceGroup
            label="How to read these changes"
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
            onClick={() => openChangedFile(absoluteOf(workspacePath, target.file))}
          >
            <FileText />
          </IconButton>
        ) : null}
      </Text>
      <Separator />
      {isImage ? (
        <ImageDiffBody file={target.file} sides={imageDiff} error={error} />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <DiffNote error>{error}</DiffNote>
          ) : lines === null ? (
            <SkeletonCode label="Diff" lines={12} />
          ) : stepping && step ? (
            <StepBody step={step} />
          ) : (
            <DiffContent lines={lines} virtualize={virtualize} rowVirtualizer={rowVirtualizer} />
          )}
          {truncated && lines !== null && !stepping ? (
            <Surface as="p" tone="sidebar" className="sticky bottom-0 px-3 py-1.5">
              <Text bare size="caption" tone="muted">
                This diff is too long to show whole.
              </Text>
            </Surface>
          ) : null}
        </div>
      )}
      {stepping && steps ? (
        <>
          <Separator />
          <div className="flex flex-none items-center gap-2 p-2">
            <IconButton label="Previous step" disabled={at <= 0} onClick={() => setAt(at - 1)}>
              <ChevronLeft />
            </IconButton>
            <Text bare tone="muted" className="text-xs">
              Step {Math.min(at, steps.length - 1) + 1} of {steps.length}
            </Text>
            <IconButton
              label="Next step"
              disabled={at >= steps.length - 1}
              onClick={() => setAt(at + 1)}
            >
              <ChevronRight />
            </IconButton>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One hunk on its own, for reading a long change a step at a time. */
function StepBody({ step }: { step: DiffStep }) {
  return (
    <div className="context-diff">
      {step.heading ? (
        <Surface tone="faint" className="px-3 py-1.5">
          <Text bare tone="muted">
            {step.heading}
          </Text>
        </Surface>
      ) : null}
      {step.lines.map((line, index) => (
        <Surface
          key={index}
          tone={line.kind === "added" ? "added" : line.kind === "removed" ? "removed" : "none"}
          className="flex gap-2 px-3"
          data-kind={line.kind}
        >
          <Text
            bare
            tone={line.kind === "added" ? "added" : line.kind === "removed" ? "removed" : "muted"}
            className="w-2.5 flex-none select-none"
            aria-hidden="true"
          >
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
          </Text>
          <span className="sr-only">
            {line.kind === "added" ? "Added: " : line.kind === "removed" ? "Removed: " : ""}
          </span>
          <Text
            bare
            tone={line.kind === "added" ? "bright" : "muted"}
            className={cn("whitespace-pre-wrap break-all", line.kind === "note" && "italic")}
          >
            {line.text || " "}
          </Text>
        </Surface>
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
    return <DiffNote>Nothing to show for this file.</DiffNote>;
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

/** A diff line's text: added lines bright, removed ones plain, the rest muted. Its fill, which
 * says what the line is, comes from codeViews.css. */
const lineTone: Record<"add" | "del" | "hunk" | "none", TextTone> = {
  add: "bright",
  del: "default",
  hunk: "muted",
  none: "muted",
};

const DiffLine = memo(function DiffLine({ line }: { line: AnnotatedLine }) {
  const kind = diffLineKind(line.text);
  return (
    <Text
      bare
      as="div"
      tone={lineTone[kind ?? "none"]}
      className="git-diff-line flex break-all whitespace-pre-wrap"
      data-kind={kind ?? undefined}
    >
      <LineNumber value={line.oldNo} />
      <LineNumber value={line.newNo} />
      <span className="sr-only">
        {kind === "add" ? "Added: " : kind === "del" ? "Removed: " : ""}
      </span>
      <span className="min-w-0 flex-1 pr-3">{line.text.length > 0 ? line.text : " "}</span>
    </Text>
  );
});

/** A line's number in the old or the new file, faint beside the code and never selected with it. */
function LineNumber({ value }: { value: number | null }) {
  return (
    <Text bare tone="muted" className="w-9 flex-none pr-2 text-right opacity-70 select-none">
      {value ?? ""}
    </Text>
  );
}

/** A line in place of the diff: there is nothing to show, or reading it failed. */
function DiffNote({ error, children }: { error?: boolean; children: string }) {
  return (
    <Text
      bare
      as="div"
      size="meta"
      tone="muted"
      className="grid min-h-0 flex-1 place-content-center justify-items-center gap-3 px-4 py-6 text-center"
    >
      {error ? (
        <Text wrap tone="failed" role="alert">
          {children}
        </Text>
      ) : (
        <p>{children}</p>
      )}
    </Text>
  );
}

/** The image before and after. A side that doesn't exist in a version is left out, so a new
 * image shows one pane rather than an empty comparison. Clicking one shows it at full size. */
function ImageDiffBody(props: { file: string; sides: GitImageDiff | null; error: string | null }) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  if (props.error) {
    return <DiffNote error>{props.error}</DiffNote>;
  }
  if (props.sides === null) {
    return (
      <div className={imagesClass} aria-hidden="true">
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
    return <DiffNote>No changes</DiffNote>;
  }
  return (
    <div className={imagesClass}>
      {panes
        .filter((pane) => zoomed === null || zoomed === pane.key)
        .map((pane) => (
          <Surface
            as="figure"
            key={pane.key}
            tone="none"
            edge="hairline"
            radius="lg"
            className="m-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <Text bare as="figcaption" tone="muted" className="flex-none px-2 py-1 text-micro">
              {pane.label}
            </Text>
            <Separator />
            <Surface
              tone="faint"
              className="grid min-h-0 flex-1 place-items-center overflow-auto p-2"
            >
              <Pressable
                aria-label={`${pane.label}: ${props.file}`}
                aria-pressed={zoomed === pane.key}
                className={zoomed === pane.key ? "cursor-zoom-out" : "cursor-zoom-in"}
                onClick={() => setZoomed(zoomed === pane.key ? null : pane.key)}
              >
                <img
                  src={pane.src}
                  alt=""
                  className={
                    zoomed === pane.key
                      ? "max-h-none max-w-none object-contain"
                      : "max-h-full max-w-full object-contain"
                  }
                />
              </Pressable>
            </Surface>
          </Surface>
        ))}
    </div>
  );
}
