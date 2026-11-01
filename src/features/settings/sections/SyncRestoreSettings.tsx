import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, stringSetting, SwitchControl, TextAreaControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
export function SyncRestoreSettings(props: SettingsContentProps & { compact?: boolean }) {
  const density = props.compact ? "compact" : "normal";
  return (
    <SettingsSectionBlock title="Switching devices" density={density}>
      <SettingsRow
        label="Restore page state when switching devices"
        density={density}
        description="Forms, open sections and scroll position. Never passwords."
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
        description="Field values pass through Misty's server and are not stored."
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
        description="One per line. Covers subdomains."
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
