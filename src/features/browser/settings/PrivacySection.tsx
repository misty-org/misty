import { DesktopSettingsSection as SettingsSectionBlock } from "@/features/settings";
import { ClearWebsiteDataRow } from "./ClearWebsiteDataRow";

export function PrivacySection() {
  return (
    <SettingsSectionBlock title="Website data">
      <ClearWebsiteDataRow />
    </SettingsSectionBlock>
  );
}
