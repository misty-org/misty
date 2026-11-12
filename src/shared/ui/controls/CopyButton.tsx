import { Check, Copy } from "lucide-react";
import * as React from "react";

import { notify } from "../feedback/notices";
import { renderIcon, type IconSource } from "../layout/ActionBar";
import { IconButton, type IconButtonProps } from "./IconButton";

/** How long the check stays after a copy. */
export const copyConfirmationMs = 1500;

/**
 * Counts confirmations and clears them after `copyConfirmationMs`, so a second copy restarts the
 * check's time instead of ending it early. `confirm` does nothing once the button has unmounted.
 */
export function useCopyConfirmation() {
  const [count, setCount] = React.useState(0);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (!count) return;
    const timer = window.setTimeout(() => setCount(0), copyConfirmationMs);
    return () => window.clearTimeout(timer);
  }, [count]);
  const confirm = React.useCallback(() => {
    if (alive.current) setCount((current) => current + 1);
  }, []);
  return { confirmed: count > 0, confirm };
}

export type CopyButtonProps = Omit<
  IconButtonProps,
  "children" | "label" | "onClick" | "loading" | "value" | "onCopy"
> & {
  /** The text to copy, or a function that gives it at click time. */
  value?: string | (() => string);
  /**
   * Copies in its own way instead of `value`, such as a rich copy of a message. Return a promise to
   * show the check only once it resolves; a rejected one shows none and reports its own error.
   */
  onCopy?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  /** Its name and tooltip. Defaults to "Copy". */
  label?: string;
  /** Defaults to the Copy glyph. */
  icon?: IconSource;
};

function isPromise(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as Promise<unknown>).then === "function";
}

/**
 * The one copy button: an IconButton whose icon turns into a check for a moment after it copies,
 * with no words. With `value` it writes that text to the clipboard and says so in a notice if the
 * clipboard refuses; with `onCopy` the caller copies.
 *
 * ```tsx
 * <CopyButton value={command} />
 * <CopyButton label="Copy link" size="sm" value={() => shareUrl(page)} />
 * ```
 */
const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  ({ value, onCopy, label = "Copy", icon = Copy, ...props }, ref) => {
    const { confirmed, confirm } = useCopyConfirmation();
    const copy = (event: React.MouseEvent<HTMLButtonElement>) => {
      let result: void | Promise<unknown>;
      if (onCopy) result = onCopy(event);
      else {
        const text = typeof value === "function" ? value() : (value ?? "");
        result = Promise.resolve()
          .then(() => navigator.clipboard.writeText(text))
          .catch((error: unknown) => {
            notify({ tone: "error", message: "Couldn't copy to the clipboard." });
            throw error;
          });
      }
      if (isPromise(result)) result.then(confirm, () => undefined);
      else confirm();
    };
    return (
      <IconButton
        ref={ref}
        label={label}
        data-slot="copy-button"
        data-confirmed={confirmed || undefined}
        {...props}
        onClick={copy}
      >
        {confirmed ? <Check aria-hidden="true" /> : renderIcon(icon)}
      </IconButton>
    );
  },
);
CopyButton.displayName = "CopyButton";

export { CopyButton };
