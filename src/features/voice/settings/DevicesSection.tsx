import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { DropdownControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";
import { savedInputDevice, useInputDevices } from "../inputDevice";

/**
 * Settings › Input › Devices: the microphone for voice input in chats. Empty is the
 * computer's own choice. Device-only.
 */
export function DevicesSection(props: SettingsContentProps) {
  const chosen = savedInputDevice((state) => state.value);
  const { devices } = useInputDevices();
  const options = [
    { value: "", label: "System default" },
    ...devices.map((device) => ({ value: device.deviceId, label: device.label })),
  ];
  return (
    <SettingsSectionBlock title="Devices">
      <SettingsRow label="Microphone">
        <DropdownControl
          value={options.some((item) => item.value === chosen) ? chosen : ""}
          options={options}
          disabled={props.working}
          onValueChange={(value) => savedInputDevice.getState().set(value)}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
