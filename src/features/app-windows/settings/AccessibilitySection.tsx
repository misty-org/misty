import { DesktopSettingsRow as SettingsRow } from "@/features/settings";
import { booleanSetting, SwitchControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settings_types";

export function AccessibilitySection(props: SettingsContentProps) {
  return (
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
  );
}
