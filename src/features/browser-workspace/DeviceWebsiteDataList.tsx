import { useUserStore } from "@/features/auth/core";
import { deviceRows } from "./deviceControl";
import type { NativeSyncView } from "./native";
import { WebsiteDataCoverage } from "./WebsiteDataCoverage";
import { currentDeviceId, deviceDataStateLabel, orderedDeviceData } from "./websiteData";

/** Each device keeps its own sign-in data; show every device this session has
 * written, the one it writes now first. */
export function DeviceWebsiteDataList({ session }: { session: NativeSyncView }) {
  const ownerName = useUserStore((state) => state.me?.name);
  const devices = session.website_data ?? [];
  if (!devices.length) return null;
  const current = currentDeviceId(session);
  const names = new Map(deviceRows(session, ownerName).map((row) => [row.device_id, row.name]));
  return (
    <div className="flex flex-col gap-2">
      {orderedDeviceData(devices, current).map((device) => (
        <section
          key={device.device_id}
          aria-label={`Website data on ${names.get(device.device_id) ?? "another device"}`}
          data-device-website-data={device.device_id}
        >
          <p className="text-sm">
            <span className="font-medium text-cream-bright">
              {names.get(device.device_id) ?? "Another device"}
            </span>
            <span className="text-cream-muted">
              {device.device_id === current ? " · in use here" : ""} ·{" "}
              {deviceDataStateLabel[device.state]}
            </span>
          </p>
          <WebsiteDataCoverage sites={device.sites} />
        </section>
      ))}
    </div>
  );
}
