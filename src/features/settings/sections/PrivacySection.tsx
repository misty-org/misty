import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { ClearBrowsingDataRow } from "./ClearBrowsingDataRow";

export function PrivacySection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Browsing data">
        <ClearBrowsingDataRow />
      </SettingsSectionBlock>
      <SettingsSectionBlock title="Data handling">
        <SettingsRow
          label="Share anonymous usage analytics"
          description="Share first-open, onboarding, and application-session events. No filenames, paths, or content."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "anonymous_usage_analytics_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "anonymous_usage_analytics_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Send anonymous crash reports"
          description="Share sanitized unexpected React and Rust errors without file or account data."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "anonymous_error_reporting_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "anonymous_error_reporting_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
