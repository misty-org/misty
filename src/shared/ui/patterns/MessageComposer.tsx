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
import { Spinner } from "../feedback/Spinner";
import { cn } from "../utils";

/** Shared by the input and mention overlay so wrapping stays aligned. */
export const messageComposerTextClass =
  "block w-full min-h-[38px] max-h-40 min-w-0 resize-none whitespace-pre-wrap break-words px-1 py-2 text-base leading-[22px] md:text-sm";

/** Layout only: feature adapters retain drafts, uploads, mentions and send behavior. */
export const MessageComposer = forwardRef<
  HTMLDivElement,
  Omit<ComponentProps<"div">, "children"> & {
    inputProps: ComponentProps<typeof Textarea> & { [key: `data-${string}`]: unknown };
    inputRef?: RefObject<HTMLTextAreaElement | null>;
    leading?: ReactNode;
    actions?: ReactNode;
    context?: ReactNode;
    overlay?: ReactNode;
    footer?: ReactNode;
  }
>(function MessageComposer(
  { inputProps, inputRef, leading, actions, context, overlay, footer, className, ...props },
  ref,
) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? localRef;
  const measured = useRef<string | null>(null);
  const resize = useCallback(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(160, Math.max(38, input.scrollHeight))}px`;
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
  return (
    <div
      ref={ref}
      data-slot="message-composer"
      className={cn(
        // No focus ring on the box or the controls inside it.
        "min-w-0 rounded-xl border border-charcoal-border bg-charcoal-card text-cream",
        "[&_:focus-visible]:border-transparent! [&_:focus-visible]:ring-0! [&_:focus-visible]:outline-none!",
        className,
      )}
      {...props}
    >
      {context}
      <div className="flex min-w-0 items-end gap-1 p-1.5">
        {leading && <div className="mb-[3px] flex shrink-0 items-center gap-1">{leading}</div>}
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
        {actions && <div className="mb-[3px] flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {footer && (
        // Footer parts may render nothing (no model yet, no draft to estimate); an empty
        // row would still pad the bottom of the composer.
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 pb-2 text-xs text-cream-muted empty:hidden [&:has(>:only-child:empty)]:hidden">
          {footer}
        </div>
      )}
    </div>
  );
});

/** Consistent send affordance; running agents can replace it with their Stop action. */
export function MessageComposerSend({
  busy,
  disabled,
  ...props
}: Omit<IconButtonProps, "children"> & { busy?: boolean }) {
  return (
    <IconButton variant="primary" {...props} disabled={disabled || busy}>
      {busy ? <Spinner label={false} /> : <ArrowUp className="size-4" />}
    </IconButton>
  );
}
