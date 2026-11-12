import { X } from "lucide-react";
import * as React from "react";

import {
  detectShortcutPlatform,
  formatShortcutLabel,
  isReservedShortcut,
  shortcutFromEvent,
} from "@/shared/shortcuts/bindings";
import type { ShortcutPlatform } from "@/shared/shortcuts/shortcutTypes";
import { cn } from "../classNames";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { FieldError } from "./Field";
import { IconButton } from "./IconButton";

const modifierKeys = ["Meta", "Control", "Alt", "Shift", "OS", "Hyper", "Super"];

type ShortcutFieldProps = {
  /** The command the shortcut runs, such as "New chat": the field's accessible name. */
  label: string;
  /** The binding as stored ("Cmd+Shift+K"), or null when the command has none. */
  value: string | null;
  /**
   * The newly recorded binding, normalized ("Cmd+Shift+K"), or null when it is cleared. The owner
   * decides whether to keep it, and passes `conflict` back when it clashes with another command.
   */
  onChange: (accelerator: string | null) => void;
  /** Why the shortcut can't be used, such as "⇧⌘K is already used by New chat". Shown under the field. */
  conflict?: React.ReactNode;
  /** What an empty field reads. Defaults to "Not set". */
  placeholder?: string;
  /** Which keycaps to draw. Defaults to the platform Misty runs on. */
  platform?: ShortcutPlatform;
  /** Accept chords the operating system keeps for itself (⌘Q, Alt+F4). Off by default. */
  allowReserved?: boolean;
  disabled?: boolean;
  /** Told when recording starts and stops, e.g. to pause the app's own shortcuts meanwhile. */
  onRecordingChange?: (recording: boolean) => void;
  className?: string;
  /** Set by Field. */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/**
 * One command's shortcut, recorded in an ordinary 32px field. Clicking it or pressing Enter starts
 * recording ("Press keys", with a red dot); the next chord becomes the binding, Escape cancels, and
 * Tab or a click elsewhere leaves it as it was. The chord reads in the sans font (⇧⌘K), and the ×
 * clears it. A conflict or a reserved chord shows under the field. One field per command.
 *
 * ```tsx
 * <ShortcutField label="New chat" value={binding} conflict={conflict}
 *   onChange={(next) => void saveBinding("chat.new", next)} />
 * ```
 */
const ShortcutField = React.forwardRef<HTMLButtonElement, ShortcutFieldProps>(
  (
    {
      label,
      value,
      onChange,
      conflict,
      placeholder = "Not set",
      platform: platformProp,
      allowReserved = false,
      disabled = false,
      onRecordingChange,
      className,
      id,
      "aria-describedby": describedByProp,
      "aria-invalid": invalidProp,
    },
    forwardedRef,
  ) => {
    const [recording, setRecording] = React.useState(false);
    const [problem, setProblem] = React.useState("");
    const boxRef = React.useRef<HTMLDivElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    React.useImperativeHandle(forwardedRef, () => buttonRef.current!, []);
    const valueId = React.useId();
    const errorId = React.useId();
    const platform = React.useMemo(() => platformProp ?? detectShortcutPlatform(), [platformProp]);

    const changeRecording = React.useCallback(
      (next: boolean) => {
        setRecording(next);
        onRecordingChange?.(next);
      },
      [onRecordingChange],
    );
    const stop = React.useCallback(() => {
      setProblem("");
      changeRecording(false);
    }, [changeRecording]);

    const start = () => {
      if (disabled) return;
      setProblem("");
      changeRecording(true);
      // WebKit doesn't focus a button on click; recording should still hold the focus.
      buttonRef.current?.focus();
    };

    const latest = React.useRef({ onChange, stop, platform, allowReserved });
    latest.current = { onChange, stop, platform, allowReserved };

    // While recording, every key is the field's, before the app's shortcuts or a settings window
    // that closes on Escape can see it, so it listens on the window in the capture phase.
    React.useEffect(() => {
      if (!recording) return;
      const onKeyDown = (event: KeyboardEvent) => {
        const { onChange, stop, platform, allowReserved } = latest.current;
        // Plain Tab moves on, so the field never traps the keyboard.
        if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          stop();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        // A modifier on its own is the start of a chord, not the chord.
        if (modifierKeys.includes(event.key)) return;
        if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          stop();
          return;
        }
        const accelerator = shortcutFromEvent(event);
        if (!accelerator) return;
        const reserved = allowReserved ? null : isReservedShortcut(accelerator, platform);
        if (reserved) {
          setProblem(reserved);
          return;
        }
        stop();
        onChange(accelerator);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (event.target instanceof Node && boxRef.current?.contains(event.target)) return;
        latest.current.stop();
      };
      window.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      return () => {
        window.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("pointerdown", onPointerDown, true);
      };
    }, [recording]);

    React.useEffect(() => {
      if (disabled && recording) stop();
    }, [disabled, recording, stop]);

    const chord = value ? formatShortcutLabel(value, platform) : "";
    const error = problem || conflict;
    const invalid = Boolean(error) || invalidProp === true || invalidProp === "true";
    const describedBy =
      [describedByProp, valueId, error ? errorId : undefined].filter(Boolean).join(" ") ||
      undefined;

    return (
      <div data-slot="shortcut-field" className={cn("grid w-full min-w-0 gap-1", className)}>
        <div
          ref={boxRef}
          data-recording={recording || undefined}
          data-invalid={invalid || undefined}
          className={cn(
            "relative flex h-8 w-full min-w-0 items-center rounded-lg border border-charcoal-border-strong",
            "bg-charcoal-card text-control transition-colors",
            "hover:border-charcoal-active focus-within:border-cream-muted",
            "data-[recording]:border-cream-muted data-[invalid]:border-danger",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          <button
            ref={buttonRef}
            id={id}
            type="button"
            disabled={disabled}
            aria-label={label}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-pressed={recording}
            data-slot="shortcut-field-record"
            className={cn(
              "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg bg-transparent px-2.5",
              "text-left font-sans outline-none",
              chord && !recording ? "text-cream" : "text-cream-muted",
            )}
            onClick={() => (recording ? undefined : start())}
          >
            {recording ? (
              <span
                aria-hidden="true"
                data-slot="shortcut-field-dot"
                className="size-1.5 shrink-0 rounded-full bg-danger"
              />
            ) : null}
            <OverflowFadeText id={valueId} className="min-w-0 flex-1">
              {recording ? "Press keys" : chord || placeholder}
            </OverflowFadeText>
          </button>
          {value && !recording ? (
            <span className="flex shrink-0 items-center pr-1">
              <IconButton
                label="Clear shortcut"
                variant="quiet"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setProblem("");
                  onChange(null);
                  buttonRef.current?.focus();
                }}
              >
                <X />
              </IconButton>
            </span>
          ) : null}
        </div>
        <FieldError id={errorId} message={error} />
      </div>
    );
  },
);
ShortcutField.displayName = "ShortcutField";

export { ShortcutField };
export type { ShortcutFieldProps };
