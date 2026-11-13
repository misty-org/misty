import { type ShortcutCommandDefinition } from "@/shared/shortcuts/shortcutTypes";
import type { ShortcutBindingSet } from "@/native/ipc";
import { Button, IconButton, ShortcutField } from "@/shared/ui";
import { RotateCcw } from "lucide-react";
import { DesktopSettingsRow } from "@/features/settings";
import { settingsDisabledControlClass } from "../../settings/settingsConstants";

/** A shortcut that clashes with another command's, held until the person reassigns it. */
export interface ShortcutConflict {
  message: string;
  onReassign: () => void;
}

/**
 * One command as a settings row: its name on the left, its shortcut in one ordinary field on the
 * right, recorded in place and cleared with its ×. A clash shows under the field with a Reassign
 * that moves the shortcut here.
 */
export function ShortcutCommandRow(props: {
  definition: ShortcutCommandDefinition;
  binding: ShortcutBindingSet;
  platform: "macos" | "windows" | "linux";
  conflict: ShortcutConflict | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
  onRecordingChange: (recording: boolean) => void;
  onRestore: () => void;
}) {
  const { definition, binding } = props;
  const customized = binding.primarySource === "user" || binding.alternateSource === "user";
  return (
    <DesktopSettingsRow label={definition.label} description={definition.description || undefined}>
      <ShortcutField
        label={definition.label}
        className="w-48"
        value={binding.primary}
        platform={props.platform}
        disabled={props.disabled}
        conflict={
          props.conflict ? (
            <span className="flex items-center gap-2">
              {props.conflict.message}
              <Button type="button" variant="quiet" size="sm" onClick={props.conflict.onReassign}>
                Reassign
              </Button>
            </span>
          ) : null
        }
        onRecordingChange={props.onRecordingChange}
        onChange={props.onChange}
      />
      <IconButton
        label={`Restore ${definition.label}`}
        hint="Restore default"
        className={settingsDisabledControlClass}
        disabled={props.disabled || !customized}
        onClick={props.onRestore}
      >
        <RotateCcw />
      </IconButton>
    </DesktopSettingsRow>
  );
}
