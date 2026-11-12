import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowUp } from "lucide-react";
import { Textarea } from "../controls/Textarea";
import { IconButton, type IconButtonProps } from "../controls/IconButton";
import { ActionBar, type ActionBarItem, type ActionBarSize } from "../layout/ActionBar";
import { PathLine, type PathLineSegment } from "../layout/PathLine";
import { cn } from "../classNames";

/**
 * Shared by the input and a mention overlay drawn over it, so their text wraps identically. Body
 * text at every window size; the box grows to 160px, then scrolls.
 */
export const messageComposerTextClass =
  "block w-full max-h-40 min-w-0 resize-none whitespace-pre-wrap break-words px-1 py-2 text-body";

/** The text box grows between these heights: one line, then up to max-h-40. */
const minInputPx = 38;
const maxInputPx = 160;

export type MessageComposerProps = Omit<ComponentProps<"div">, "children"> & {
  inputProps: ComponentProps<typeof Textarea> & { [key: `data-${string}`]: unknown };
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Above the text, inside the box: a reply banner, attachment chips. */
  context?: ReactNode;
  /** Drawn over the text box, such as mention highlights or a suggestion popup's anchor. */
  overlay?: ReactNode;
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
 *     { id: "model", icon: Sparkles, label: model.name, priority: 2, shrink: true, render: …, menu: … },
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
      items,
      end,
      barLabel = "Message options",
      barSize = "md",
      path,
      pathLabel = "Where this chat works",
      frameClassName,
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
    const box = (
      <div
        ref={ref}
        data-slot="message-composer"
        className={cn(
          "min-w-0 rounded-xl border border-charcoal-border bg-charcoal-card text-cream",
          className,
        )}
        {...props}
      >
        {context}
        <div
          data-slot="message-composer-text"
          className={cn("flex min-w-0 items-end gap-1", hasBar ? "px-2 pt-1.5" : "p-1.5")}
        >
          <div className="relative min-w-0 flex-1">
            {overlay}
            <Textarea
              {...inputProps}
              variant="composer"
              ref={textareaRef}
              rows={1}
              className={cn(messageComposerTextClass, inputProps.className)}
            />
          </div>
        </div>
        {hasBar && (
          <div data-slot="message-composer-bar" className="flex min-w-0 px-1.5 pb-1.5">
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

/** The send button every composer shares; a running agent can put its Stop button there instead. */
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
