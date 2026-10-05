import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, CopyableValueText, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { Skeleton } from "@/shared/ui";

export function AdvancedSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Diagnostics">
        <SettingsRow
          label="Frame pacing overlay"
          description="Show the live idle, light, and heavy pacing state in the top-right corner."
          last
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

      <SettingsSectionBlock title="Storage">
        <SettingsRow
          label="Config path"
          description="Where Misty stores local configuration files on this device."
        >
          {props.app?.environment.configDir ? (
            <CopyableValueText value={props.app.environment.configDir} />
          ) : (
            <Skeleton className="h-4 w-56" />
          )}
        </SettingsRow>
        <SettingsRow
          label="Data path"
          description="Where Misty stores local app data on this device."
          last
        >
          {props.app?.environment.mistyDir ? (
            <CopyableValueText value={props.app.environment.mistyDir} />
          ) : (
            <Skeleton className="h-4 w-56" />
          )}
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
