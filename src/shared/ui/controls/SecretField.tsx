import { KeyRound, Lock, MoreHorizontal, Trash2 } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { Skeleton } from "../feedback/Skeleton";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { ConfirmDeleteDialog } from "../overlays/ConfirmDeleteDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../overlays/DropdownMenu";
import { MenuItem } from "../overlays/MenuItem";
import { FieldError } from "./Field";
import { IconButton } from "./IconButton";
import { Input } from "./Input";

type SecretFieldProps = {
  /** What the secret is, such as "OpenAI key": the field's accessible name and the remove dialog's subject. */
  label: string;
  /** Whether a value is saved; null while the keychain is still being read (a skeleton shows). */
  saved: boolean | null;
  /** The empty field's placeholder. Defaults to "Paste a key" ("Paste the new key" while replacing). */
  placeholder?: string;
  /**
   * Saves a new value, trimmed and never empty. The field clears once it resolves; if it throws,
   * the error's message shows under the field and the typed value stays to fix.
   */
  onSave: (value: string) => void | Promise<void>;
  /** Removes the saved value after the person confirms. If it throws, the dialog shows why. */
  onRemove: () => void | Promise<void>;
  /** A failure the owner knows about, shown under the field. */
  error?: React.ReactNode;
  /** The saved state's words. Defaults to "Saved in keychain". */
  savedText?: string;
  /** The remove dialog's one line. Defaults to saying the key is deleted from this computer. */
  removeWhat?: string;
  disabled?: boolean;
  className?: string;
  /** Set by Field. */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/** The message a failed save or remove carries, or a plain fallback. */
function failureText(failure: unknown, fallback: string) {
  const message =
    failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
  return message.trim() || fallback;
}

/**
 * A secret such as an API key, in one control the size of an empty 32px Input. Empty, it is a
 * password field that saves on Enter or when it loses focus. Saved, it reads "Saved in keychain"
 * beside a lock, with a ⋯ inside its right edge that offers Replace key and Remove key (which asks
 * first). The saved value is never shown or read back. Errors show under the field.
 *
 * ```tsx
 * <SecretField label="OpenAI key" saved={hasKey} onSave={(key) => saveKey("openai", key)}
 *   onRemove={() => removeKey("openai")} />
 * ```
 */
const SecretField = React.forwardRef<HTMLInputElement, SecretFieldProps>(
  (
    {
      label,
      saved,
      placeholder,
      onSave,
      onRemove,
      error: errorProp,
      savedText = "Saved in keychain",
      removeWhat,
      disabled = false,
      className,
      id,
      "aria-describedby": describedByProp,
      "aria-invalid": invalidProp,
    },
    forwardedRef,
  ) => {
    const [replacing, setReplacing] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [failure, setFailure] = React.useState("");
    const [confirming, setConfirming] = React.useState(false);
    const saving = React.useRef(false);
    const failedValue = React.useRef("");
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => inputRef.current!, []);
    // Replace hands focus to the field once its menu has closed.
    const focusOnClose = React.useRef(false);
    const alive = React.useRef(true);
    React.useEffect(
      () => () => {
        alive.current = false;
      },
      [],
    );
    const errorId = React.useId();

    // A value saved or removed elsewhere ends a replace.
    React.useEffect(() => {
      setReplacing(false);
      setDraft("");
    }, [saved]);

    const editing = saved === false || replacing;
    const error = failure || errorProp;
    const invalid = Boolean(error) || invalidProp === true || invalidProp === "true";
    const describedBy =
      [describedByProp, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

    const save = async (leaving: boolean) => {
      const value = draft.trim();
      // Enter disables the field while it saves, and that blur must not save twice.
      if (saving.current) return;
      // Leaving the field again doesn't retry a value that just failed; Enter does.
      if (leaving && value && value === failedValue.current) return;
      if (!value) {
        // Leaving an empty replace keeps the saved value.
        if (replacing) setReplacing(false);
        return;
      }
      saving.current = true;
      setBusy(true);
      setFailure("");
      try {
        await onSave(value);
        failedValue.current = "";
        if (!alive.current) return;
        setDraft("");
        setReplacing(false);
      } catch (thrown) {
        failedValue.current = value;
        if (!alive.current) return;
        setFailure(failureText(thrown, `Couldn't save the ${label}. Try again.`));
      } finally {
        saving.current = false;
        if (alive.current) setBusy(false);
      }
    };

    const cancel = () => {
      setDraft("");
      setFailure("");
      setReplacing(false);
    };

    let control: React.ReactNode;
    if (saved === null) {
      control = (
        <Skeleton
          role="status"
          aria-hidden={undefined}
          aria-label={label}
          aria-busy="true"
          data-slot="secret-field-skeleton"
          className="h-8 w-full rounded-lg"
        />
      );
    } else if (editing) {
      control = (
        // Focus moving to the field's own eye button isn't leaving it, so blur is read here.
        <div
          className="w-full min-w-0"
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) return;
            void save(true);
          }}
        >
          <Input
            ref={inputRef}
            id={id}
            type="password"
            value={draft}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={label}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-busy={busy || undefined}
            placeholder={placeholder ?? (replacing ? "Paste the new key" : "Paste a key")}
            autoFocus={replacing}
            disabled={disabled || busy}
            data-slot="secret-field-input"
            onChange={(event) => {
              setDraft(event.target.value);
              if (failure) setFailure("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save(false);
              } else if (event.key === "Escape" && (draft || replacing)) {
                // Handled here, so a dialog or settings window around it stays open.
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          />
        </div>
      );
    } else {
      control = (
        <div
          data-slot="secret-field-saved"
          className={cn(
            "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-charcoal-border-strong",
            "bg-charcoal-card pr-1 pl-2.5 text-control text-cream-muted",
            invalid && "border-danger",
            disabled && "opacity-50",
          )}
        >
          <Lock aria-hidden="true" className="size-4 shrink-0" />
          <OverflowFadeText className="min-w-0 flex-1">{savedText}</OverflowFadeText>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton
                id={id}
                label={`${label} actions`}
                variant="quiet"
                size="sm"
                disabled={disabled}
                aria-describedby={describedBy}
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              aria-label={`${label} actions`}
              onCloseAutoFocus={(event) => {
                if (!focusOnClose.current) return;
                focusOnClose.current = false;
                event.preventDefault();
                inputRef.current?.focus();
              }}
            >
              <MenuItem
                icon={KeyRound}
                label="Replace key"
                onSelect={() => {
                  setFailure("");
                  focusOnClose.current = true;
                  setReplacing(true);
                }}
              />
              <MenuItem
                icon={Trash2}
                label="Remove key"
                danger
                onSelect={() => {
                  setFailure("");
                  setConfirming(true);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    }

    return (
      <div
        data-slot="secret-field"
        data-state={saved === null ? "loading" : editing ? "empty" : "saved"}
        className={cn("grid w-full min-w-0 gap-1", className)}
      >
        {control}
        <FieldError id={errorId} message={error} />
        <ConfirmDeleteDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Remove the ${label}?`}
          what={removeWhat ?? "It's deleted from this computer's keychain and can't be recovered."}
          confirmLabel="Remove"
          onConfirm={onRemove}
        />
      </div>
    );
  },
);
SecretField.displayName = "SecretField";

export { SecretField };
export type { SecretFieldProps };
