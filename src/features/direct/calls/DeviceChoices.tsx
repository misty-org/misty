import { MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@misty/ui";
import { useCallDevices, type CallDeviceKind } from "./call_devices";

export function DeviceChoices({
  kind,
  title,
  value,
  onPick,
}: {
  kind: CallDeviceKind;
  title: string;
  value: string;
  onPick: (deviceId: string) => void;
}) {
  const devices = useCallDevices(kind);
  const picked = devices.some((device) => device.deviceId === value) ? value : "";
  return (
    <>
      <MenuLabel>{title}</MenuLabel>
      <MenuRadioGroup value={picked} onValueChange={onPick}>
        <MenuRadioItem value="" label="System default" />
        {devices.map((device) => (
          <MenuRadioItem key={device.deviceId} value={device.deviceId} label={device.label} />
        ))}
      </MenuRadioGroup>
    </>
  );
}

export function SpeakerChoices({
  value,
  onPick,
}: {
  value: string;
  onPick: (deviceId: string) => void;
}) {
  const speakers = useCallDevices("audiooutput");
  if (!speakers.length) return null;
  return (
    <>
      <MenuSeparator />
      <DeviceChoices kind="audiooutput" title="Speaker" value={value} onPick={onPick} />
    </>
  );
}
