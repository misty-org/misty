import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  autosaveDelayOptions,
  autosaveDelayValues,
  editorTabSizeOptions,
  editorTabSizeValues,
} from "../settingsConstants";
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

export function CodeSection(props: SettingsContentProps) {
  const autosaveDelay = numberSetting(props.document, "editor", "autosave_delay_ms", 1000);
  const tabSize = numberSetting(props.document, "editor", "tab_size", 2);

  return (
    <>
      <SettingsSectionBlock title="Text">
        <SettingsRow label="Font family" description="Leave empty to use Misty's monospace stack.">
          <TextControl
            value={stringSetting(props.document, "editor", "font_family", "")}
            placeholder="JetBrains Mono, SF Mono, Menlo"
            disabled={props.working}
            wide
            onCommit={(value) => props.onSettingChange("editor", "font_family", value.trim())}
          />
        </SettingsRow>
        <SettingsRow label="Font size" description="Editor text size in the Code workspace.">
          <NumberControl
            value={numberSetting(props.document, "editor", "font_size", 12.5)}
            min={8}
            max={32}
            step={0.5}
            suffix="px"
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("editor", "font_size", value)}
          />
        </SettingsRow>
        <SettingsRow label="Tab size" description="How far one indent level moves." last>
          <SelectControl
            value={Math.max(0, editorTabSizeValues.indexOf(tabSize))}
            options={editorTabSizeOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("editor", "tab_size", editorTabSizeValues[value] ?? 2)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Editing">
        <SettingsRow label="Word wrap" description="Wrap long lines instead of scrolling sideways.">
          <SwitchControl
            checked={booleanSetting(props.document, "editor", "word_wrap", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("editor", "word_wrap", value)}
          />
        </SettingsRow>
        <SettingsRow label="Line numbers" description="Show the line number gutter.">
          <SwitchControl
            checked={booleanSetting(props.document, "editor", "line_numbers", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("editor", "line_numbers", value)}
          />
        </SettingsRow>
        <SettingsRow label="Autosave" description="Write changes to disk after you stop typing.">
          <SelectControl
            value={Math.max(0, autosaveDelayValues.indexOf(autosaveDelay))}
            options={autosaveDelayOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("editor", "autosave_delay_ms", autosaveDelayValues[value] ?? 0)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Format on save"
          description="Run the language server's formatter when a file is saved."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "editor", "format_on_save", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("editor", "format_on_save", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
