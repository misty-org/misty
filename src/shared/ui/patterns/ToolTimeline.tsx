// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import { ChevronRight, Layers, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Pressable } from "../controls/Pressable";
import { cn } from "../classNames";
import "./toolTimeline.css";

/**
 * How an agent's turn shows its work: one fold for the whole turn (TurnFold), then one quiet row
 * per step (ToolRow), in the order they ran, with nothing boxed: no groups, tables or cards. A row
 * that has more to show opens into a ToolBody that hangs off a thin line under it. Notes Misty
 * wrote between steps sit between the rows (ToolNote).
 *
 * ```tsx
 * <TurnFold summary="Read 3 files · ran 2 commands" open={open} onToggle={toggle} />
 * <ToolList label="Steps">
 *   <ToolRow icon={FileText} name="Read" target={<ToolPath path="src/auth/session.ts" />} />
 *   <ToolRow icon={SquareTerminal} name="Ran" target="npm test" meta="12s" open={o} onToggle={t}
 *     controls="out" />
 * </ToolList>
 * ```
 */

/**
 * The turn's one line: what it is doing while it runs (with a moving highlight), what it did once
 * it ends. It opens to the turn's steps; `more` says how many earlier steps a live turn keeps
 * folded above the latest ones.
 */
export function TurnFold(props: {
  summary: ReactNode;
  live?: boolean;
  open: boolean;
  onToggle(): void;
  /** The id of what it opens. */
  controls?: string;
  /** Earlier steps a live turn hides; pressing the line shows them all. */
  more?: number;
  icon?: LucideIcon;
}) {
  const Icon = props.icon ?? Layers;
  return (
    <Pressable
      className="misty-turn-fold"
      data-open={props.open || undefined}
      aria-expanded={props.open}
      aria-controls={props.controls}
      onClick={props.onToggle}
    >
      <Icon aria-hidden="true" className="misty-turn-fold-icon" />
      <span
        className={cn("misty-turn-fold-label", props.live && "misty-turn-fold-live")}
        aria-live="polite"
      >
        {props.summary}
      </span>
      {props.more ? <span className="misty-turn-fold-more">+{props.more} more</span> : null}
      <ChevronRight aria-hidden="true" className="misty-turn-fold-chevron" />
    </Pressable>
  );
}

/** The turn's steps, one row each with no gap between them. */
export function ToolList(props: { label: string; children: ReactNode; id?: string }) {
  return (
    <ol id={props.id} className="misty-tool-list" aria-label={props.label}>
      {props.children}
    </ol>
  );
}

/**
 * One step on one 32px line: its icon, what it did (muted), what it acted on (full color, fading
 * at the edge), and its end (a duration, a count, line changes). It has no fill or border. A row
 * that opens swaps its icon for a chevron on hover; a running step is dimmed, a failed one red.
 * Render it inside a ToolList `li`, with its ToolBody after it.
 */
export function ToolRow(props: {
  icon: LucideIcon;
  name: string;
  target?: ReactNode;
  meta?: ReactNode;
  state?: "running" | "done" | "failed";
  /** Given with onToggle, the row opens its body. */
  open?: boolean;
  onToggle?(): void;
  /** The id of the body it opens. */
  controls?: string;
}) {
  const Icon = props.icon;
  const content = (
    <>
      <span className="misty-tool-row-icon" aria-hidden="true">
        <Icon className="misty-tool-row-glyph" />
        <ChevronRight className="misty-tool-row-chevron" />
      </span>
      <span className="misty-tool-row-name">{props.name}</span>
      {props.target ? <span className="misty-tool-row-target">{props.target}</span> : null}
      {props.state === "failed" ? <span className="sr-only">, failed</span> : null}
      {props.meta ? <span className="misty-tool-row-meta">{props.meta}</span> : null}
    </>
  );
  const shared = {
    className: "misty-tool-row",
    "data-state": props.state ?? "done",
    "data-open": props.open || undefined,
  };
  return props.onToggle ? (
    <Pressable
      {...shared}
      data-expandable=""
      aria-expanded={Boolean(props.open)}
      aria-controls={props.controls}
      onClick={props.onToggle}
    >
      {content}
    </Pressable>
  ) : (
    <div {...shared}>{content}</div>
  );
}

/** A path as a row shows it: the folder muted, the file's name in full color. */
export function ToolPath({ path }: { path: string }) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut < 0 || cut === path.length - 1) return <>{path}</>;
  return (
    <>
      <span className="misty-tool-row-dim">{path.slice(0, cut + 1)}</span>
      {path.slice(cut + 1)}
    </>
  );
}

/** Lines a step added and removed, in their own colors, each with its sign. */
export function ToolLines(props: { added?: number; removed?: number }) {
  if (!props.added && !props.removed) return null;
  return (
    <span className="misty-tool-lines">
      {props.added ? <span data-tone="added">+{props.added}</span> : null}
      {props.removed ? <span data-tone="removed">−{props.removed}</span> : null}
    </span>
  );
}

/**
 * What an opened row shows, hanging off a thin line under the row's icon. The line folds the row
 * again when pressed. Code inside keeps its own monospace; prose is the row's size.
 */
export function ToolBody(props: { onFold?(): void; children: ReactNode }) {
  return (
    <div className="misty-tool-body">
      <span className="misty-tool-body-line" aria-hidden="true" onClick={props.onFold} />
      {props.children}
    </div>
  );
}

/** What the agent wrote between steps: quiet prose at the rows' size. */
export function ToolNote({ children }: { children: ReactNode }) {
  return <div className="misty-tool-note">{children}</div>;
}
