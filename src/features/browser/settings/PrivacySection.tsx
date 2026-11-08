import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { stringSetting, TextAreaControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";
import { ClearBrowsingDataRow } from "./ClearBrowsingDataRow";

/** Misty sends no usage analytics or crash reports, so there is nothing here to opt out of. */
export function PrivacySection(props: SettingsContentProps) {
  return (
    <SettingsSectionBlock title="Browsing data">
      <ClearBrowsingDataRow />
      <SettingsRow label="Don't capture page state on these sites" stacked>
        <TextAreaControl
          value={stringSetting(props.document, "privacy", "page_state_excluded_sites", "")}
          rows={5}
          disabled={props.working}
          onCommit={(value) => props.onSettingChange("privacy", "page_state_excluded_sites", value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
