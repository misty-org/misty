import * as React from "react";

import { cn } from "../classNames";
import { CopyButton } from "../controls/CopyButton";
import { Text, type TextTone } from "./Text";

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

/** The code sizes: micro 11, caption 12, meta 13. */
export type CodeTextSize = "micro" | "caption" | "meta";

const codeSizeClass: Record<CodeTextSize, string> = {
  micro: "text-micro",
  caption: "text-caption",
  meta: "text-meta",
};

export interface CodeTextProps extends React.HTMLAttributes<HTMLPreElement> {
  /** Defaults to caption. */
  size?: CodeTextSize;
  /** One of `Text`'s tones; leave it out to keep the surrounding color. */
  tone?: TextTone;
  ref?: React.Ref<HTMLPreElement>;
}

/**
 * Code with no frame of its own, in the code font: a command, a tool's raw output, a step's text
 * output inside something that already frames it. It keeps its line breaks and wraps long lines
 * rather than scrolling sideways. `className` is for layout only (padding, line height, a max
 * height that scrolls). Code to read and copy by itself is a CodeBlock.
 *
 * ```tsx
 * <CodeText tone="muted" className="max-h-60 overflow-auto px-3">{output}</CodeText>
 * ```
 */
export function CodeText({ size = "caption", tone, className, children, ...props }: CodeTextProps) {
  return (
    <pre
      {...props}
      data-slot="code-text"
      className={cn(
        "m-0 min-w-0 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]",
        codeSizeClass[size],
        className,
      )}
    >
      <Text as="code" bare tone={tone}>
        {children}
      </Text>
    </pre>
  );
}
