import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
export function SyncRestoreSettings(props: SettingsContentProps) {
  return (
    <SettingsSectionBlock title="Switching devices">
      <SettingsRow
        label="Restore page state when switching devices"
        description={
          "Bring back half-filled forms, open sections and scroll position on the device " +
          "you switch to. Passwords and payment details are never saved."
        }
      >
        <SwitchControl
          checked={booleanSetting(props.document, "privacy", "page_state_restore", true)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("privacy", "page_state_restore", value)}
        />
      </SettingsRow>
      <SettingsRow
        label="Let agents finish restoring"
        description={
          "When fields only appear after a click, Misty's agent fills them in. Those field " +
          "values go through Misty's server to the AI provider and are not stored."
        }
      >
        <SwitchControl
          checked={
            booleanSetting(props.document, "privacy", "page_state_restore", true) &&
            booleanSetting(props.document, "privacy", "page_state_agent_restore", true)
          }
          disabled={
            props.working || !booleanSetting(props.document, "privacy", "page_state_restore", true)
          }
          onChange={(value) => props.onSettingChange("privacy", "page_state_agent_restore", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
