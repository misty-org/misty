import { cn } from "../classNames";

/** What a diff line is: added, removed, unchanged context, or a hunk's `@@` header. */
export type CodeDiffLineKind = "add" | "del" | "context" | "header";

export interface CodeDiffLine {
  kind: CodeDiffLineKind;
  text: string;
  /** The line's number before the change; empty for an added line. */
  oldNumber?: number;
  /** The line's number after the change; empty for a removed line. */
  newNumber?: number;
}

export interface CodeDiffProps {
  lines: ReadonlyArray<CodeDiffLine>;
  /** The table's accessible name, such as "Changes". */
  label: string;
  /** Layout only. */
  className?: string;
}

const signOf: Record<CodeDiffLineKind, string> = { add: "+", del: "-", header: "@", context: " " };

const rowClass: Record<CodeDiffLineKind, string> = {
  add: "bg-[color:color-mix(in_srgb,var(--tone-added)_14%,transparent)]",
  del: "bg-[color:color-mix(in_srgb,var(--tone-failed)_13%,transparent)]",
  header: "text-cream-muted",
  context: "",
};

const signClass: Record<CodeDiffLineKind, string> = {
  add: "text-[var(--tone-added)]",
  del: "text-[var(--tone-failed)]",
  header: "",
  context: "",
};

/**
 * A diff in the code font, one row per line: its old and new line numbers (small and muted), its
 * sign, then the line, which wraps rather than scrolling sideways. Added and removed lines take a
 * faint wash of their Git colors and a colored sign; nothing else carries color. It draws no frame:
 * put it in the panel that holds it, which also decides its height and scrolling.
 *
 * ```tsx
 * <CodeDiff label="Changes" lines={[{ kind: "add", text: "const a = 1;", newNumber: 3 }]} />
 * ```
 */
export function CodeDiff({ lines, label, className }: CodeDiffProps) {
  return (
    <div
      role="table"
      aria-label={label}
      data-slot="code-diff"
      className={cn("font-mono text-caption leading-[1.55]", className)}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          role="row"
          data-kind={line.kind}
          className={cn("flex items-baseline px-2", rowClass[line.kind])}
        >
          <span className="w-8 shrink-0 pr-2 text-right text-micro text-cream-muted tabular-nums opacity-70 select-none">
            {line.oldNumber ?? ""}
          </span>
          <span className="w-8 shrink-0 pr-2 text-right text-micro text-cream-muted tabular-nums opacity-70 select-none">
            {line.newNumber ?? ""}
          </span>
          <span
            aria-hidden="true"
            className={cn("w-3.5 shrink-0 text-center select-none", signClass[line.kind])}
          >
            {signOf[line.kind]}
          </span>
          <span className="flex-1 pl-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {line.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}
