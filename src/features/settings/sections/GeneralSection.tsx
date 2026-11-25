import { startupViewOption, startupViewOptions, startupViewStoredIndex } from "@/app/shell";
import { DesktopSettingsRow as SettingsRow } from "../components/DesktopSettingsUI";
import { booleanSetting, numberSetting, SelectControl, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settings_types";

export function LaunchOnLoginRow(props: SettingsContentProps) {
  const unsupported = props.launchOnLogin?.supported === false;
  return (
    <SettingsRow
      label="Launch on login"
      muted={unsupported}
      description={
        unsupported
          ? "Unavailable on this platform."
          : "Start Misty when you sign in to this computer."
      }
    >
      <SwitchControl
        checked={booleanSetting(props.document, "general", "launch_on_login", false)}
        disabled={props.working || unsupported}
        onChange={(value) => props.onSettingChange("general", "launch_on_login", value)}
      />
    </SettingsRow>
  );
}

export function ReopenSessionRows(props: SettingsContentProps) {
  const reopenLastSession = booleanSetting(props.document, "general", "reopen_last_session", true);
  return (
    <>
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
    </>
  );
}
