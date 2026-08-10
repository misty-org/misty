import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

const focusableSelector =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  restoreTargetRef?: RefObject<HTMLElement | null>,
) {
  const dialogRef = useRef<T | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      restoreTargetRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = dialogRef.current;
    const target =
      dialog?.querySelector<HTMLElement>("[data-dialog-autofocus]") ??
      dialog?.querySelector<HTMLElement>(focusableSelector);
    target?.focus();
    return () => {
      const restoreTarget = restoreFocusRef.current;
      queueMicrotask(() => {
        if (restoreTarget?.isConnected) restoreTarget.focus();
      });
    };
  }, [open, restoreTargetRef]);

  const trapFocus = (event: ReactKeyboardEvent<T>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, trapFocus };
}
