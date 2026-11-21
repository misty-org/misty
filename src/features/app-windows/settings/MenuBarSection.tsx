import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import type { SettingsContentProps } from "@/features/settings/settingsTypes";
import { useTrayHidden } from "@/shared/lib/trayHidden";

/** Settings › Server › Menu bar: whether Misty's icon shows there. Device-only. */
export function MenuBarSection(props: SettingsContentProps) {
  const hidden = useTrayHidden((state) => state.value);
  return (
    <SettingsSectionBlock title="Menu bar">
      <SettingsRow
        label="Show the menu bar icon"
        description="Without it, closing the last window quits Misty and the Space drives stop syncing."
      >
        <SwitchControl
          checked={!hidden}
          disabled={props.working}
          onChange={(shown) => useTrayHidden.getState().set(!shown)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
