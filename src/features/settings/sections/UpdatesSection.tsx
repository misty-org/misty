import { openUrl } from "@tauri-apps/plugin-opener";
import { DesktopUpdaterSettings } from "@/features/updater";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function UpdatesSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Updates">
        <DesktopUpdaterSettings />
        <SettingsRow label="Check for updates automatically" description="Checks on launch.">
          <SwitchControl
            checked={booleanSetting(props.document, "general", "auto_update_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "auto_update_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
      {/* The attribution the license's section 7(b) term asks every copy to keep (NOTICE). */}
      <SettingsSectionBlock title="About">
        <SettingsRow
          label="Misty, created by Matthew Chen"
          description="Free software under the GNU AGPL-3.0 or later. A changed Misty must keep this line and offer its source."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl("https://github.com/misty-org/misty")}
          >
            Source code
          </Button>
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
