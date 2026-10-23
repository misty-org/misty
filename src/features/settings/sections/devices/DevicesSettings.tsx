import { useConnectedDevices } from "@/features/connected-devices";
import { Button, Skeleton } from "@/shared/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsSection as Section,
} from "../../components/DesktopSettingsUI";
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
      <Section title="Your devices">
        <div className="grid gap-3 py-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-5 w-64" />
        </div>
      </Section>
    );
  }
  const names = new Map(devices.devices.map((device) => [device.id, device.name]));
  return (
    <>
      {devices.error ? (
        <Section title="Devices">
          <DesktopSettingsNotice
            action={
              <Button variant="outline" size="sm" onClick={() => void devices.refresh()}>
                Try again
              </Button>
            }
          >
            The device list could not be loaded.
          </DesktopSettingsNotice>
        </Section>
      ) : null}
      {devices.removed || (devices.ready && !devices.view?.admitted) ? <AddThisDevice /> : null}
      <PendingApprovals />
      {devices.peers.length ? (
        <Section title="Your devices" description="Manage the devices connected to this account.">
          {devices.peers.map((peer) => (
            <DeviceSection
              key={peer.id}
              peer={peer}
              approvedBy={peer.approvedByDeviceId ? names.get(peer.approvedByDeviceId) : undefined}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}
