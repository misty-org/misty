import { startupViewOptions } from "@/features/app-shell";
import { workspaceDefaultTabOptions } from "@/features/workspace/workspaceDefaultTab";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, numberSetting, SelectControl, SwitchControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function GeneralSection(props: SettingsContentProps) {
  const launchOnLoginUnsupported = props.launchOnLogin?.supported === false;
  const launchOnLoginEnabled = props.launchOnLogin
    ? props.launchOnLogin.enabled
    : booleanSetting(props.document, "general", "launch_on_login", false);
  const reopenLastSession = booleanSetting(props.document, "general", "reopen_last_session", true);

  return (
    <>
      <SettingsSectionBlock title="Startup">
        {!isNativeMobileBuild ? (
          <SettingsRow
            label="Launch on login"
            muted={launchOnLoginUnsupported}
            description={
              launchOnLoginUnsupported
                ? "Unavailable on this platform."
                : "Start Misty automatically when you sign in to this device."
            }
          >
            <SwitchControl
              checked={launchOnLoginEnabled}
              disabled={props.working || launchOnLoginUnsupported}
              onChange={(value) => props.onSettingChange("general", "launch_on_login", value)}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow
          label="Reopen last session"
          description="Return to whichever view you were last in instead of a fixed one."
        >
          <SwitchControl
            checked={reopenLastSession}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "reopen_last_session", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Open on launch"
          description="The view Misty starts on when it is not reopening your last session."
          muted={reopenLastSession}
        >
          <SelectControl
            value={numberSetting(props.document, "general", "startup_view_index", 0)}
            options={startupViewOptions}
            disabled={props.working || reopenLastSession}
            onChange={(value) => props.onSettingChange("general", "startup_view_index", value)}
          />
        </SettingsRow>
        {!isNativeMobileBuild ? (
          <SettingsRow
            label="Default tab"
            description="The tab opened in every new panel and virtual window."
            last
          >
            <SelectControl
              value={numberSetting(props.document, "general", "workspace_default_tab_index", 0)}
              options={[...workspaceDefaultTabOptions]}
              disabled={props.working}
              onChange={(value) =>
                props.onSettingChange("general", "workspace_default_tab_index", value)
              }
            />
          </SettingsRow>
        ) : null}
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Behavior">
        <SettingsRow
          label="Confirm destructive actions"
          description="Ask before delete, empty trash, and other irreversible actions."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "general", "confirm_destructive_actions", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "confirm_destructive_actions", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
