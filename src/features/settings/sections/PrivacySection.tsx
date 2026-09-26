import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, stringSetting, SwitchControl, TextAreaControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function PrivacySection(props: SettingsContentProps & { page?: "app" | "browser" }) {
  return (
    <>
      {props.page === "browser" && (
        <>
          <SettingsSectionBlock title="Switching devices">
            <SettingsRow
              label="Restore page state when switching devices"
              description="Bring back half-filled forms, open sections and scroll position on the device you switch to. Passwords and payment details are never saved."
            >
              <SwitchControl
                checked={booleanSetting(props.document, "privacy", "page_state_restore", true)}
                disabled={props.working}
                onChange={(value) => props.onSettingChange("privacy", "page_state_restore", value)}
              />
            </SettingsRow>
            <SettingsRow
              label="Let agents finish restoring"
              description="When fields only appear after a click, Misty's agent fills them in. Those field values go through Misty's server to the AI provider and are not stored."
            >
              <SwitchControl
                checked={
                  booleanSetting(props.document, "privacy", "page_state_restore", true) &&
                  booleanSetting(props.document, "privacy", "page_state_agent_restore", true)
                }
                disabled={
                  props.working ||
                  !booleanSetting(props.document, "privacy", "page_state_restore", true)
                }
                onChange={(value) =>
                  props.onSettingChange("privacy", "page_state_agent_restore", value)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Don't capture page state on these sites"
              description="One site per line. Subdomains are included. Only the address and scroll position are kept."
              last
            >
              <TextAreaControl
                value={stringSetting(props.document, "privacy", "page_state_excluded_sites", "")}
                rows={5}
                disabled={props.working}
                onCommit={(value) =>
                  props.onSettingChange("privacy", "page_state_excluded_sites", value)
                }
              />
            </SettingsRow>
          </SettingsSectionBlock>
        </>
      )}
      {props.page !== "browser" && (
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
            last
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
      )}
    </>
  );
}
