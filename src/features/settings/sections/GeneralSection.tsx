import { startupViewOption, startupViewOptions, startupViewStoredIndex } from "@/app/shell";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, numberSetting, SelectControl, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
export function GeneralSection(props: SettingsContentProps) {
  const launchOnLoginUnsupported = props.launchOnLogin?.supported === false;
  const launchOnLoginEnabled = booleanSetting(props.document, "general", "launch_on_login", false);
  const reopenLastSession = booleanSetting(props.document, "general", "reopen_last_session", true);
  return (
    <>
      <SettingsSectionBlock title="Startup">
        {
          <SettingsRow
            label="Launch on login"
            muted={launchOnLoginUnsupported}
            description={
              launchOnLoginUnsupported
                ? "Unavailable on this platform."
                : "Start Misty when you sign in to this computer."
            }
          >
            <SwitchControl
              checked={launchOnLoginEnabled}
              disabled={props.working || launchOnLoginUnsupported}
              onChange={(value) => props.onSettingChange("general", "launch_on_login", value)}
            />
          </SettingsRow>
        }
        <SettingsRow label="Reopen last session">
          <SwitchControl
            checked={reopenLastSession}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "reopen_last_session", value)}
          />
        </SettingsRow>
        <SettingsRow label="Otherwise open" muted={reopenLastSession} indent>
          <SelectControl
            value={startupViewOption(
              numberSetting(props.document, "general", "startup_view_index", 0),
            )}
            options={startupViewOptions}
            disabled={props.working || reopenLastSession}
            onChange={(value) =>
              props.onSettingChange("general", "startup_view_index", startupViewStoredIndex(value))
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
