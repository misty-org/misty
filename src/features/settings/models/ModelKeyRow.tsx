import { Button, cn, Input, Skeleton } from "@/shared/ui";
import { useState } from "react";
import { DesktopSettingsRow as Row } from "../components/DesktopSettingsUI";
import { settingsDisabledControlClass } from "../settingsConstants";

/**
 * One provider's key. A saved key is never shown or read back; the row says it is saved and
 * offers Replace and Remove. A new key is written to the keychain on Enter or when the field
 * loses focus, and the field clears.
 */
export function ModelKeyRow(props: {
  label: string;
  description: string;
  providerId: string;
  /** Providers with a saved key, or null while the keychain is read. */
  saved: string[] | null;
  disabled?: boolean;
  onSave: (providerId: string, key: string) => Promise<boolean>;
  onRemove: (providerId: string) => Promise<boolean>;
}) {
  const [replacing, setReplacing] = useState("");
  const [busy, setBusy] = useState(false);
  const has = props.saved?.includes(props.providerId) ?? false;
  const editing = !has || replacing === props.providerId;
  const act = async (work: () => Promise<boolean>) => {
    setBusy(true);
    const done = await work();
    setBusy(false);
    if (done) setReplacing("");
  };
  const commit = (field: HTMLInputElement) => {
    const key = field.value.trim();
    field.value = "";
    if (key) void act(() => props.onSave(props.providerId, key));
    else setReplacing("");
  };
  return (
    <Row label={props.label} description={props.description}>
      <div className="flex w-[240px] max-w-full items-center justify-end gap-2">
        {props.saved === null ? (
          <Skeleton aria-label={`${props.label} status`} className="h-9 w-full rounded-md" />
        ) : editing ? (
          <Input
            // A new provider or a Replace starts from an empty field.
            key={`${props.providerId}:${replacing}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={props.label}
            placeholder={has ? "Paste the new key" : "Paste a key"}
            autoFocus={replacing === props.providerId}
            disabled={props.disabled || busy}
            className={cn("w-full", settingsDisabledControlClass)}
            onBlur={(event) => commit(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              else if (event.key === "Escape") {
                event.currentTarget.value = "";
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <>
            <span className="mr-auto text-[14px] text-cream-muted">Saved</span>
            <Button
              variant="outline"
              size="sm"
              disabled={props.disabled || busy}
              onClick={() => setReplacing(props.providerId)}
            >
              Replace
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={props.disabled || busy}
              onClick={() => void act(() => props.onRemove(props.providerId))}
            >
              Remove
            </Button>
          </>
        )}
      </div>
    </Row>
  );
}
