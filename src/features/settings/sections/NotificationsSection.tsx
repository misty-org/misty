import { DesktopSettingsSection as SettingsSectionBlock } from "../components/DesktopSettingsUI";
import { PreferenceRow } from "./PreferenceRow";

/** Settings › Profile › Notifications: what Misty tells the person, and when it stays quiet. */
export function NotificationsSection() {
  return (
    <SettingsSectionBlock title="Notifications">
      <PreferenceRow id="agents.run_notifications" />
    </SettingsSectionBlock>
  );
}
