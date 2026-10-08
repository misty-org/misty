import { useConnectedDevices } from "@/features/connected-devices";
import { Skeleton } from "@/shared/ui";
import { DesktopSettingsSection as Section } from "../../components/DesktopSettingsUI";
import { SettingsNote } from "../../SettingsControls";
import { AddThisDevice } from "./AddThisDevice";
import { DeviceSection } from "./DeviceSection";
import { PendingApprovals } from "./PendingApprovals";

/**
 * Settings → Devices (docs/design/devices/BRIEF.md): this device first, then
 * the others. Each device's permissions can be changed only on that device.
 */
export function DevicesSettings() {
  const devices = useConnectedDevices();
  if (devices.loading && !devices.peers.length) {
    return (
      <Section title="This device">
        <div className="grid gap-3 border-t border-charcoal-border py-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-5 w-64" />
        </div>
      </Section>
    );
  }
  if (devices.removed) {
    return (
      <Section title="This device">
        <SettingsNote>
          This device was removed from your account. Sign in again and add it to use sync, agents
          and file sharing here.
        </SettingsNote>
      </Section>
    );
  }
  const names = new Map(devices.devices.map((device) => [device.id, device.name]));
  return (
    <>
      {devices.error ? (
        <Section title="Status">
          <SettingsNote>{devices.error}</SettingsNote>
        </Section>
      ) : null}
      {devices.ready && !devices.view?.admitted ? <AddThisDevice /> : null}
      <PendingApprovals />
      {devices.peers.map((peer) => (
        <DeviceSection
          key={peer.id}
          peer={peer}
          approvedBy={peer.approvedByDeviceId ? names.get(peer.approvedByDeviceId) : undefined}
        />
      ))}
    </>
  );
}
