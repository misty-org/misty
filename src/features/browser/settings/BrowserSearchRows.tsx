import { DesktopSettingsRow as SettingsRow, settingsBoolean } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import type { SettingsContentProps } from "@/features/settings/settings_types";

export function BrowserSearchRows(props: SettingsContentProps) {
  return (
    <SettingsRow
      label="Search suggestions"
      description="Sends what you type in the address field to Google."
    >
      <SwitchControl
        checked={settingsBoolean(props.document, "general", "browser_search_suggestions", true)}
        disabled={props.working}
        onChange={(value) => props.onSettingChange("general", "browser_search_suggestions", value)}
      />
    </SettingsRow>
  );
}
