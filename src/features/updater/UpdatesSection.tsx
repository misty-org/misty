import { DesktopUpdaterSettings } from "./DesktopUpdaterSettings";
import { DesktopSettingsRow as SettingsRow } from "@/features/settings";
import { booleanSetting, SwitchControl } from "../settings/SettingsControls";
import type { SettingsContentProps } from "../settings/settings_types";

export function UpdatesSection(props: SettingsContentProps) {
  return (
    <>
      <DesktopUpdaterSettings />
      <SettingsRow label="Check for updates automatically" description="Checks on launch.">
        <SwitchControl
          checked={booleanSetting(props.document, "general", "auto_update_enabled", true)}
          disabled={props.working}
          onChange={(value) => props.onSettingChange("general", "auto_update_enabled", value)}
        />
      </SettingsRow>
    </>
  );
}
