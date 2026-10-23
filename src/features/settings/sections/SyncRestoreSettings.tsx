import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, stringSetting, SwitchControl, TextAreaControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
export function SyncRestoreSettings(props: SettingsContentProps & { compact?: boolean }) {
  const density = props.compact ? "compact" : "normal";
  return (
    <SettingsSectionBlock
      title="Switching devices"
      description="Choose what Misty restores when you open this workspace on another device. These controls only affect page state."
      density={density}
    >
      <SettingsRow
        label="Restore page state when switching devices"
        density={density}
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
        density={density}
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
      <SettingsRow
        label="Don't capture page state on these sites"
        density={density}
        description="One site per line. Subdomains are included. Only the address and scroll position are kept."
        stacked
      >
        <TextAreaControl
          value={stringSetting(props.document, "privacy", "page_state_excluded_sites", "")}
          rows={5}
          disabled={props.working}
          onCommit={(value) => props.onSettingChange("privacy", "page_state_excluded_sites", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
