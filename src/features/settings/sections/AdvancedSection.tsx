import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function AdvancedSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Diagnostics">
        <SettingsRow
          label="Frame pacing overlay"
          description="Show the live idle, light, and heavy pacing state in the top-right corner."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "frame_pacing_overlay_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "frame_pacing_overlay_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
