import {
  workspaceDefaultViewIndex,
  workspaceDefaultViewOption,
  workspaceDefaultViewOptions,
  workspaceDefaultViewStoredIndex,
} from "@/features/workspace/workspaceDefaultView";
import { startupViewOptions } from "@/features/app-shell";
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
                : "Start Misty automatically when you sign in to this device."
            }
          >
            <SwitchControl
              checked={launchOnLoginEnabled}
              disabled={props.working || launchOnLoginUnsupported}
              onChange={(value) => props.onSettingChange("general", "launch_on_login", value)}
            />
          </SettingsRow>
        }
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
          label="Otherwise open"
          description="The view Misty starts on when it is not reopening your last session."
          muted={reopenLastSession}
          indent
        >
          <SelectControl
            value={numberSetting(props.document, "general", "startup_view_index", 0)}
            options={startupViewOptions}
            disabled={props.working || reopenLastSession}
            onChange={(value) => props.onSettingChange("general", "startup_view_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Behavior">
        <SettingsRow
          label="New tabs and splits"
          description="Choose the starting page. Selecting a navbar destination fills an unused tab or pane."
        >
          <SelectControl
            value={workspaceDefaultViewOption(
              numberSetting(
                props.document,
                "general",
                "workspace_default_tab_index",
                workspaceDefaultViewIndex,
              ),
            )}
            options={[...workspaceDefaultViewOptions]}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "general",
                "workspace_default_tab_index",
                workspaceDefaultViewStoredIndex(value),
              )
            }
          />
        </SettingsRow>
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
