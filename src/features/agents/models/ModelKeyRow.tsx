import { SecretField } from "@/shared/ui";
import { DesktopSettingsRow as Row } from "@/features/settings";
import type { SavedModelKeys } from "./modelKeys";

/**
 * One provider's key as a settings row. A saved key is never shown or read back; the field says
 * it's saved and offers Replace and Remove in its menu. A new key goes to the keychain on Enter
 * or when the field loses focus.
 */
export function ModelKeyRow(props: {
  label: string;
  /** What the key is called in its field and the remove dialog, such as "OpenAI key". */
  keyName?: string;
  description: string;
  providerId: string;
  keys: SavedModelKeys;
  /** Saves a pasted key; defaults to saving it for `providerId`. */
  onSave?: (key: string) => Promise<void>;
}) {
  return (
    <Row label={props.label} description={props.description}>
      <SecretField
        label={props.keyName ?? props.label}
        className="w-60 max-w-full"
        saved={props.keys.saved ? props.keys.saved.includes(props.providerId) : null}
        onSave={props.onSave ?? ((key) => props.keys.saveKey(props.providerId, key))}
        onRemove={() => props.keys.removeKey(props.providerId)}
      />
    </Row>
  );
}
