import { DesktopSettingsRow as SettingsRow } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import type { SettingsContentProps } from "@/features/settings/settings_types";
import { useTrayHidden } from "@/shared/lib/tray_hidden";

export function MenuBarSection(props: SettingsContentProps) {
  const hidden = useTrayHidden((state) => state.value);
  return (
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
  );
}
