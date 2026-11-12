import "./prose.css";
import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";

export type ProseSize = "meta" | "control" | "body" | "page";

export type ProseProps = {
  children?: React.ReactNode;
  /** The text role. Leave it out to keep the surrounding size, as a chat message sets it. */
  size?: ProseSize;
  /** Layout only: margins, height caps, scrolling. */
  className?: string;
};

const sizeClass: Record<ProseSize, string> = {
  meta: "text-meta",
  control: "text-control",
  body: "text-body",
  page: "text-page",
};

/**
 * Read-only rich text: paragraphs, lists, headings, quotes, links, tables, code, task lists,
 * math and footnotes, rendered from Markdown or any HTML of those elements. It sets the spacing
 * and the monochrome look of each; only code inside it is monospace. MistyMarkdown renders into
 * it, so a reply, a plan and a preview read alike.
 *
 * ```tsx
 * <Prose size="body"><MistyMarkdown>{reply}</MistyMarkdown></Prose>
 * ```
 */
export function Prose({ children, size, className }: ProseProps) {
  return (
    <div data-slot="prose" className={cn("misty-prose", size && sizeClass[size], className)}>
      {children}
    </div>
  );
}

/** A table that scrolls sideways inside the prose instead of stretching it, with hairline rules. */
export function ProseTable({ children }: { children?: React.ReactNode }) {
  return (
    <div data-slot="prose-table" className="misty-prose-table">
      <table>{children}</table>
    </div>
  );
}

/**
 * A callout (GitHub's `> [!NOTE]`): its kind as an icon and a label over the content, on a
 * monochrome surface. Warnings and cautions take a stronger edge.
 */
export function ProseCallout({
  kind,
  label,
  icon: Icon,
  children,
}: {
  kind: "note" | "tip" | "important" | "warning" | "caution";
  /** The kind in words, "Note" or "Warning": its title and accessible name. */
  label: string;
  icon: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <aside
      data-slot="prose-callout"
      data-callout={kind}
      aria-label={label}
      className="misty-prose-callout"
    >
      <p className="misty-prose-callout-title">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {label}
      </p>
      {children}
    </aside>
  );
}

/**
 * A code block: a header with the language and the block's actions (Copy), then the code, wrapped
 * so nothing hides past the edge. The ref is the `pre`, for reading its text.
 */
export const ProseCode = React.forwardRef<
  HTMLPreElement,
  {
    /** Shown in the header; defaults to "Code". */
    language?: string;
    /** 24px IconButtons at the header's right end, such as Copy code. */
    actions?: React.ReactNode;
    children?: React.ReactNode;
  }
>(({ language, actions, children }, ref) => (
  <div data-slot="prose-code" className="misty-prose-code">
    <div className="misty-prose-code-header">
      <span>{language || "Code"}</span>
      {actions}
    </div>
    <pre ref={ref}>{children}</pre>
  </div>
));
ProseCode.displayName = "ProseCode";

/** Text that isn't parsed (yet): kept as written, line breaks and all, wrapping at the edge. */
export function ProsePlain({ children }: { children?: React.ReactNode }) {
  return (
    <div data-slot="prose-plain" className="misty-prose-plain">
      {children}
    </div>
  );
}

/**
 * One slice of a long document parsed on its own. It lays out as if it weren't there, so the
 * prose spacing runs across slices; `busy` while it still shows its plain text.
 */
export function ProseChunk({ children, busy }: { children?: React.ReactNode; busy?: boolean }) {
  return (
    <div data-slot="prose-chunk" aria-busy={busy || undefined} className="contents">
      {children}
    </div>
  );
}

/**
 * Spread on a link inside prose that opens a local file rather than a page: dotted underline,
 * the surrounding color. `<a {...proseFileLink} href={href}>…</a>`
 */
export const proseFileLink = { "data-prose-link": "file" } as const;
