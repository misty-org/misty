import { DesktopSettingsRow as SettingsRow } from "@/features/settings";
import { DropdownControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settings_types";
import { savedInputDevice, useInputDevices } from "../input_device";

export function MicrophoneRow(props: SettingsContentProps) {
  const chosen = savedInputDevice((state) => state.value);
  const { devices } = useInputDevices();
  const options = [
    { value: "", label: "System default" },
    ...devices.map((device) => ({ value: device.deviceId, label: device.label })),
  ];
  return (
    <SettingsRow label="Microphone">
      <DropdownControl
        value={options.some((item) => item.value === chosen) ? chosen : ""}
        options={options}
        disabled={props.working}
        onValueChange={(value) => savedInputDevice.getState().set(value)}
      />
    </SettingsRow>
  );
}
