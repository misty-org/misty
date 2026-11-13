import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowUp, type LucideIcon } from "lucide-react";
import { Textarea } from "../controls/Textarea";
import { IconButton, type IconButtonProps } from "../controls/IconButton";
import { ActionBar, type ActionBarItem, type ActionBarSize } from "../layout/ActionBar";
import { PathLine, type PathLineSegment } from "../layout/PathLine";
import { cn } from "../classNames";

/** The text box without its inset and type; the box grows to 160px, then scrolls. */
const textBaseClass = "block w-full max-h-40 min-w-0 resize-none whitespace-pre-wrap break-words";

/**
 * Shared by the plain composer's input and a mention overlay drawn over it, so their text wraps
 * identically. Body text at every window size.
 */
export const messageComposerTextClass = `${textBaseClass} px-1 py-2 text-body`;

/** The text box grows between these heights: one line, then up to max-h-40. */
const minInputPx = 38;
const maxInputPx = 160;

/**
 * plain: a bordered box that sits in its pane. card: the box floats as one roomy rounded card
 * with a faint edge (stronger while typing) and a soft shadow, the text and its bar inset alike
 * so the + glyph lines up with the text above it.
 */
export type MessageComposerVariant = "plain" | "card";

const boxClass = {
  plain: "rounded-xl border",
  // No border: a hairline ring and a soft shadow lift it off the page, the ring firmer while typing.
  card: "relative rounded-xl transition-[box-shadow] duration-140",
} as const;
/** The box's edge and fill while nothing is dragged over it. */
const restingClass = {
  plain: "border-charcoal-border bg-charcoal-card",
  card: [
    "bg-charcoal-card",
    "shadow-[0_0_0_0.5px_color-mix(in_srgb,var(--misty-theme-text)_11%,transparent),0_10px_28px_-14px_rgb(0_0_0/0.6)]",
    "focus-within:shadow-[0_0_0_0.5px_color-mix(in_srgb,var(--misty-theme-text)_22%,transparent),0_10px_28px_-14px_rgb(0_0_0/0.6)]",
  ],
} as const;
/** Files dragged over the box. */
const draggingClass = {
  plain: "border-cream-muted bg-charcoal-hover",
  card: "bg-charcoal-hover shadow-[0_0_0_1px_var(--color-cream-muted)]",
} as const;

/** The card's text: 14px in a 22px line, or body type in a taller box when roomy. */
const cardTextClass = {
  compact: "min-h-11 px-0.5 py-1 text-control leading-5.5",
  roomy: "min-h-16 px-0.5 py-1.5 text-body",
} as const;

export type MessageComposerProps = Omit<ComponentProps<"div">, "children"> & {
  inputProps: ComponentProps<typeof Textarea> & { [key: `data-${string}`]: unknown };
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** plain (default) or card; see MessageComposerVariant. */
  variant?: MessageComposerVariant;
  /** card only: a taller box in body type, for a chat with nothing in it yet. */
  roomy?: boolean;
  /** Files are dragged over the box: its edge and fill say it will take them. */
  dragging?: boolean;
  /**
   * Above the text, inside the box: a reply banner, attachment chips. In the card it is laid in
   * one row that scrolls sideways when it outruns the box, never a stack.
   */
  context?: ReactNode;
  /** Drawn over the text box, such as mention highlights or a suggestion popup's anchor. */
  overlay?: ReactNode;
  /**
   * card only: rows about the chat's state at the top of the box, above the text, such as
   * messages queued to send next: each a ComposerStatusRow, parted by hairlines.
   */
  status?: ReactNode;
  /**
   * The bar under the text, in order: the leading controls (the + menu with attach and screen
   * capture, the mode), then the one long name that may shorten, such as the model, marked
   * `shrink`. It never wraps: labels turn into icons, the shrink item fades, then items fold
   * into ⋯, in the order their priorities say.
   */
  items?: ReadonlyArray<ActionBarItem>;
  /** The bar's end, which never folds: the last controls and the send (or stop) button. */
  end?: ReactNode;
  /** The bar's accessible name. Default "Message options". */
  barLabel?: string;
  /** The bar's control height: md 32 (default) or sm 24. */
  barSize?: ActionBarSize;
  /** Where the chat works, as one quiet line under the box: Space › folder › branch. */
  path?: ReadonlyArray<PathLineSegment>;
  /** The path line's accessible name. Default "Where this chat works". */
  pathLabel?: string;
  /** Layout classes for the wrapper that holds the box and its path line, when there is one. */
  frameClassName?: string;
};

/**
 * The message box every chat uses. Layout only: feature adapters keep drafts, uploads, mentions
 * and sending. The text grows with its content, the bar under it gives way instead of wrapping,
 * and the path line sits under the box.
 *
 * ```tsx
 * <MessageComposer
 *   inputProps={{ value, onChange, "aria-label": "Message" }}
 *   items={[
 *     { id: "add", icon: Plus, label: "Add", priority: 3, render: () => <AddMenu />, menu: <AddRows /> },
 *     { id: "model", icon: Cpu, label: model.name, priority: 2, shrink: true, render: …, menu: … },
 *   ]}
 *   end={<MessageComposerSend label="Send" disabled={!value.trim()} />}
 *   path={[{ icon: Layers, label: space.name }, { icon: GitBranch, label: branch, menu: <BranchRows /> }]}
 * />
 * ```
 */
export const MessageComposer = forwardRef<HTMLDivElement, MessageComposerProps>(
  function MessageComposer(
    {
      inputProps,
      inputRef,
      context,
      overlay,
      status,
      items,
      end,
      barLabel = "Message options",
      barSize = "md",
      path,
      pathLabel = "Where this chat works",
      frameClassName,
      variant = "plain",
      roomy = false,
      dragging = false,
      className,
      ...props
    },
    ref,
  ) {
    const localRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = inputRef ?? localRef;
    const measured = useRef<string | null>(null);
    const resize = useCallback(() => {
      const input = textareaRef.current;
      if (!input) return;
      input.style.height = "0px";
      input.style.height = `${Math.min(maxInputPx, Math.max(minInputPx, input.scrollHeight))}px`;
      measured.current = input.value;
    }, [textareaRef]);
    useLayoutEffect(() => {
      const input = textareaRef.current;
      if (!input) return;
      // Collapsing to 0px and re-measuring forces two layouts per keystroke. Appended text
      // that still fits cannot change the height, so skip it.
      if (
        measured.current !== null &&
        input.value.startsWith(measured.current) &&
        input.scrollHeight <= input.clientHeight
      )
        measured.current = input.value;
      else resize();
    }, [inputProps.value, textareaRef, resize]);
    useLayoutEffect(() => {
      const input = textareaRef.current;
      if (!input || typeof ResizeObserver === "undefined") return;
      let width = input.clientWidth;
      const observer = new ResizeObserver(() => {
        if (width === input.clientWidth) return;
        width = input.clientWidth;
        resize();
      });
      observer.observe(input);
      return () => observer.disconnect();
    }, [textareaRef, resize]);

    const hasBar = Boolean(items?.length || end);
    const card = variant === "card";
    const box = (
      <div
        ref={ref}
        data-slot="message-composer"
        data-variant={variant}
        className={cn(
          "min-w-0 text-cream",
          boxClass[variant],
          dragging ? draggingClass[variant] : restingClass[variant],
          className,
        )}
        {...props}
      >
        {card && status ? (
          <div
            data-slot="message-composer-status"
            className="flex min-w-0 flex-col border-b border-[color:color-mix(in_srgb,var(--misty-theme-text)_7%,transparent)] empty:hidden"
          >
            {status}
          </div>
        ) : null}
        {card && context ? (
          <div
            data-slot="message-composer-context"
            className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden px-3 pt-2.5"
          >
            {context}
          </div>
        ) : (
          context
        )}
        <div
          data-slot="message-composer-text"
          className={cn(
            "flex min-w-0 items-end gap-1",
            card ? (hasBar ? "px-3 pt-2.5" : "px-3 py-2.5") : hasBar ? "px-2 pt-1.5" : "p-1.5",
          )}
        >
          <div className="relative min-w-0 flex-1">
            {overlay}
            <Textarea
              {...inputProps}
              variant="composer"
              ref={textareaRef}
              rows={1}
              className={cn(
                card
                  ? [textBaseClass, cardTextClass[roomy ? "roomy" : "compact"]]
                  : messageComposerTextClass,
                inputProps.className,
              )}
            />
          </div>
        </div>
        {hasBar && (
          <div
            data-slot="message-composer-bar"
            className={cn("flex min-w-0", card ? "px-2 pt-1 pb-2" : "px-1.5 pb-1.5")}
          >
            <ActionBar label={barLabel} size={barSize} items={items ?? []} end={end} />
          </div>
        )}
      </div>
    );
    if (!path?.length) return box;
    return (
      <div
        data-slot="message-composer-frame"
        className={cn("flex min-w-0 flex-col", frameClassName)}
      >
        {box}
        <PathLine label={pathLabel} segments={path} className="px-3" />
      </div>
    );
  },
);

/**
 * The send button every composer shares, the height of every other control in the composer's row
 * (controls in one row share one height); a running agent can put its Stop button (the same size)
 * there instead.
 */
export function MessageComposerSend({
  busy,
  disabled,
  ...props
}: Omit<IconButtonProps, "children"> & {
  /** Sending: a spinner replaces the arrow and clicks are held. */
  busy?: boolean;
}) {
  return (
    <IconButton variant="primary" {...props} loading={busy} disabled={disabled || busy}>
      <ArrowUp />
    </IconButton>
  );
}

/**
 * One row at the top of a card composer, about the chat's state: a muted glyph, what it says
 * (fading at the edge), and its actions at the end. 32px, with a hairline under all but the last.
 */
export function ComposerStatusRow(props: {
  icon: LucideIcon;
  /** A short muted word before the text, such as "Queued". */
  label?: string;
  children: ReactNode;
  /** Small quiet buttons at the row's end. */
  actions?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div
      data-slot="composer-status-row"
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 pr-1 pl-3 text-meta text-cream-muted",
        "[&+&]:border-t [&+&]:border-[color:color-mix(in_srgb,var(--misty-theme-text)_7%,transparent)]",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {props.label ? <span className="shrink-0">{props.label}</span> : null}
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-cream [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
        {props.children}
      </span>
      {props.actions ? (
        <span className="flex shrink-0 items-center gap-0.5">{props.actions}</span>
      ) : null}
    </div>
  );
}
