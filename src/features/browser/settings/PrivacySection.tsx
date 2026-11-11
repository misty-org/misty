import { DesktopSettingsSection as SettingsSectionBlock } from "@/features/settings";
import { ClearWebsiteDataRow } from "./ClearWebsiteDataRow";

/** Misty sends no usage analytics or crash reports, so there is nothing here to opt out of. */
export function PrivacySection() {
  return (
    <SettingsSectionBlock title="Website data">
      <ClearWebsiteDataRow />
    </SettingsSectionBlock>
  );
}
