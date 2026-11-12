import * as React from "react";

import { cn } from "../classNames";
import { CopyButton } from "../controls/CopyButton";

export interface CodeBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** The code, exactly as it should be copied. */
  code: string;
  /**
   * Long lines wrap onto the next line instead of scrolling sideways. Off by default, since code
   * reads by its lines; turn it on for a command or a path a person should see whole.
   */
  wrap?: boolean;
  /** Shows the copy button. On by default. */
  copy?: boolean;
  /** The copy button's name and tooltip. Defaults to "Copy". */
  copyLabel?: string;
}

/**
 * Code to read and copy: a framed block in the code font at the meta size, scrolling sideways
 * (or wrapping with `wrap`), with a copy button in its corner that shows while the block is
 * hovered or holds focus and always on touch screens. `className` is for layout only.
 *
 * ```tsx
 * <CodeBlock code={`claude mcp add misty -- ${command}`} wrap />
 * ```
 */
export function CodeBlock({
  code,
  wrap = false,
  copy = true,
  copyLabel = "Copy",
  className,
  ...props
}: CodeBlockProps) {
  return (
    <div
      {...props}
      data-slot="code-block"
      data-wrap={wrap || undefined}
      className={cn(
        "group/code relative min-w-0 rounded-lg border border-charcoal-border bg-charcoal-card",
        className,
      )}
    >
      <pre
        className={cn(
          "m-0 min-w-0 px-3 py-2 font-mono text-meta text-cream [tab-size:2]",
          wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "overflow-x-auto whitespace-pre",
          copy && "pr-10",
        )}
      >
        <code>{code}</code>
      </pre>
      {copy ? (
        <CopyButton
          value={code}
          label={copyLabel}
          size="sm"
          className={cn(
            "absolute top-1.5 right-1.5 opacity-0 transition-opacity",
            "group-hover/code:opacity-100 group-focus-within/code:opacity-100",
            "data-[confirmed]:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        />
      ) : null}
    </div>
  );
}
