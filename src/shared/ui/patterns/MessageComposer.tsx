import {
  forwardRef,
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
  useLayoutEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      input.style.height = `${Math.min(160, Math.max(38, input.scrollHeight))}px`;
    };
    resize();
    let width = input.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (width === input.clientWidth) return;
            width = input.clientWidth;
            resize();
          });
    observer?.observe(input);
    return () => observer?.disconnect();
  }, [inputProps.value, textareaRef]);
  return (
    <div
      ref={ref}
      data-slot="message-composer"
      className={cn(
        "min-w-0 rounded-xl border border-charcoal-border bg-charcoal-card text-cream focus-within:border-cream-muted",
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
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 pb-2 text-xs text-cream-muted">
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
