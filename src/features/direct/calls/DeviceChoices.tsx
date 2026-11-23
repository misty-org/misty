import { MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@misty/ui";
import { useCallDevices, type CallDeviceKind } from "./call_devices";

const noDevices: Record<CallDeviceKind, string> = {
  audioinput: "No microphones found",
  audiooutput: "No speakers found",
  videoinput: "No cameras found",
};

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
  return (
    <>
      <MenuLabel>{title}</MenuLabel>
      {devices.length ? (
        <MenuRadioGroup value={value} onValueChange={onPick}>
          {devices.map((device) => (
            <MenuRadioItem key={device.deviceId} value={device.deviceId} label={device.label} />
          ))}
        </MenuRadioGroup>
      ) : (
        <MenuItem label={noDevices[kind]} disabled />
      )}
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
