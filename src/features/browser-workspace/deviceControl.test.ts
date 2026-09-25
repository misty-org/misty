import { expect, it } from "vitest";
import { deviceRows, transferRate } from "./deviceControl";
import type { NativeSyncView } from "./native";
it("lists offline devices, excludes revoked devices, and does not claim stale presence is connected", () => {
  const view = {
    device_id: "local",
    status: { phase: "ready" },
    workspace: { active_device: { device_id: "remote" } },
    devices: [
      { device_id: "local", full_sync: false, control_version: 1 },
      { device_id: "remote", display_name: "Office", full_sync: true, control_version: 1 },
      { device_id: "gone", revoked_at: "yesterday" },
    ],
    presence: [
      { device_id: "gone", online: true },
      { device_id: "remote", online: false },
    ],
  } as NativeSyncView;
  expect(deviceRows(view).map((d) => [d.device_id, d.connection, d.full_sync])).toEqual([
    ["local", "Connected", false],
    ["remote", "Offline", true],
  ]);
  view.status.phase = "offline";
  expect(deviceRows(view).every((d) => d.connection === "Unknown")).toBe(true);
});
it("measures bytes over elapsed time and discards first samples and session counter resets", () => {
  expect(transferRate(null, 3000, 2000)).toBeNull();
  expect(transferRate({ bytes: 1000, at: 1000 }, 3000, 2000)).toBe(2000);
  expect(transferRate({ bytes: 3000, at: 2000 }, 10, 3000)).toBeNull();
  expect(transferRate({ bytes: 3000, at: 2000 }, 3000, 3000)).toBe(0);
});
