import type { ShortcutBinding } from "@/native/contracts";
import { Button, Input } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";

import {
  settingsControlButtonCompactClass,
  settingsInlineActionsClass,
  settingsPrimaryButtonClass,
  settingsReferenceHeaderClass,
  settingsReferenceListClass,
  settingsReferenceRowClass,
  settingsReferenceSpanClass,
} from "../settingsConstants";
import { booleanSetting, SettingsNote, SwitchControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function ShortcutsSection(props: SettingsContentProps) {
  const conflicts = conflictingShortcuts(props.shortcuts);

  return (
    <>
      <SettingsSectionBlock title="Navigation">
        <SettingsRow
          label="Show shortcut hints"
          description="Display shortcut hints in tooltips and menus where helpful."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "shortcut_hints_enabled", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "shortcut_hints_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Customization">
        <SettingsRow
          label="Enable custom shortcuts"
          description="Use saved per-command shortcut overrides instead of only Misty's built-in defaults."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "custom_shortcuts_enabled", false)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "custom_shortcuts_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Bindings">
        <SettingsNote>
          {conflicts.size > 0
            ? `${conflicts.size} shortcut${conflicts.size === 1 ? " is" : "s are"} assigned to more than one command. Conflicting rows are marked below.`
            : "Every command has a distinct shortcut."}
        </SettingsNote>
        <div className={settingsReferenceListClass}>
          <div className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}>
            <span>Command</span>
            <span>Shortcut</span>
          </div>
          {props.shortcuts.map((binding) => {
            const conflicted = conflicts.has(normalizeShortcut(binding.shortcut));
            return (
              <div className={settingsReferenceRowClass} key={binding.commandId}>
                <span className={settingsReferenceSpanClass}>{binding.commandId}</span>
                <Input
                  value={binding.shortcut}
                  disabled={props.working}
                  aria-invalid={conflicted}
                  title={conflicted ? "Also assigned to another command" : undefined}
                  className={conflicted ? "border-notification-red" : undefined}
                  onChange={(event) =>
                    props.onShortcutChange(binding.commandId, event.target.value)
                  }
                />
              </div>
            );
          })}
        </div>
        <div className={settingsInlineActionsClass}>
          <Button
            type="button"
            className={settingsPrimaryButtonClass}
            disabled={props.working}
            onClick={() => void props.onSaveShortcuts()}
          >
            Save Changes
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            className={settingsControlButtonCompactClass}
            disabled={props.working}
            onClick={() => void props.onResetShortcuts()}
          >
            Restore defaults
          </Button>
        </div>
      </SettingsSectionBlock>
    </>
  );
}

/** Case- and order-insensitive, so "Cmd+Shift+K" and "shift+cmd+k" collide. */
function normalizeShortcut(shortcut: string): string {
  return shortcut
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join("+");
}

function conflictingShortcuts(bindings: ShortcutBinding[]): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const binding of bindings) {
    const normalized = normalizeShortcut(binding.shortcut);
    if (!normalized) continue;
    if (seen.has(normalized)) duplicated.add(normalized);
    seen.add(normalized);
  }
  return duplicated;
}
