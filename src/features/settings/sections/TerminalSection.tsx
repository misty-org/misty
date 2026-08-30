import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { terminalCursorStyleOptions, terminalOptions } from "../settingsConstants";
import {
  booleanSetting,
  NumberControl,
  numberSetting,
  SelectControl,
  stringSetting,
  SwitchControl,
  TextControl,
} from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function TerminalSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Appearance">
        <SettingsRow label="Font family" description="Leave empty to use Misty's monospace stack.">
          <TextControl
            value={stringSetting(props.document, "terminal", "font_family", "")}
            placeholder="JetBrains Mono, SF Mono, Menlo"
            disabled={props.working}
            wide
            onCommit={(value) => props.onSettingChange("terminal", "font_family", value.trim())}
          />
        </SettingsRow>
        <SettingsRow label="Font size" description="Base size before Cmd + and Cmd - scaling.">
          <NumberControl
            value={numberSetting(props.document, "terminal", "font_size", 13)}
            min={8}
            max={32}
            suffix="px"
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("terminal", "font_size", value)}
          />
        </SettingsRow>
        <SettingsRow label="Cursor style" description="How the terminal cursor is drawn.">
          <SelectControl
            value={numberSetting(props.document, "terminal", "cursor_style_index", 0)}
            options={terminalCursorStyleOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("terminal", "cursor_style_index", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Blink cursor"
          description="Blink the cursor while the shell is idle."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "terminal", "cursor_blink", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("terminal", "cursor_blink", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Behavior">
        <SettingsRow
          label="Scrollback"
          description="How many lines of output each shell keeps in memory."
        >
          <NumberControl
            value={numberSetting(props.document, "terminal", "scrollback", 50_000)}
            min={1000}
            max={500_000}
            step={1000}
            suffix="lines"
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("terminal", "scrollback", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="External terminal"
          description="Which terminal app opens from the Files toolbar."
          last
        >
          <SelectControl
            value={Math.max(
              0,
              terminalOptions.indexOf(
                stringSetting(
                  props.document,
                  "general",
                  "preferred_terminal_app",
                  "System Default",
                ),
              ),
            )}
            options={terminalOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "general",
                "preferred_terminal_app",
                terminalOptions[value] ?? "System Default",
              )
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
