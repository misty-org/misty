import { InstallerCard } from "@/features/installer";
import { DesktopUpdaterSettings } from "@/features/updater";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SwitchControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function UpdatesSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Updates">
        <DesktopUpdaterSettings />
        <SettingsRow
          label="Check for updates automatically"
          description="Look for a new Misty version on launch. You can always check manually above."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "general", "auto_update_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "auto_update_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Runtime">
        <div className="bg-charcoal-card">
          <InstallerCard
            embedded
            variant="compact"
            className={
              "[&_button:disabled]:border-charcoal-border/80 " +
              "[&_button:disabled]:bg-charcoal-bg [&_button:disabled]:text-cream-muted " +
              "[&_button:disabled]:opacity-100 [&_button:disabled]:shadow-none"
            }
          />
        </div>
      </SettingsSectionBlock>
    </>
  );
}
