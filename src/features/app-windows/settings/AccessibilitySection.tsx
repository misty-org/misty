import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { booleanSetting, SwitchControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

/** Settings › Interface › Accessibility: how much the interface moves. Device-only. */
export function AccessibilitySection(props: SettingsContentProps) {
  return (
    <SettingsSectionBlock title="Accessibility">
      <SettingsRow
        label="Reduce motion"
        description="Panels and menus appear without sliding or fading. Spinners keep turning."
      >
        <SwitchControl
          checked={booleanSetting(props.document, "appearance", "reduce_motion", false)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("appearance", "reduce_motion", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
