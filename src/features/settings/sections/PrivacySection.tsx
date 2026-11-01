import { DesktopSettingsSection as SettingsSectionBlock } from "../components/DesktopSettingsUI";
import { ClearBrowsingDataRow } from "./ClearBrowsingDataRow";

/** Misty sends no usage analytics or crash reports, so there is nothing here to opt out of. */
export function PrivacySection() {
  return (
    <SettingsSectionBlock title="Browsing data">
      <ClearBrowsingDataRow />
    </SettingsSectionBlock>
  );
}
