import type { MountedDevice } from "@/native/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { buildDeviceEntries, loadDeviceCustomization } from "../components/ExplorerSidebarSupport";

const startupDisk: MountedDevice = {
  id: "startup",
  volumeId: "startup",
  name: "Macintosh HD",
  mountPath: "/",
  fsType: "apfs",
  isRemovable: false,
  isSystem: true,
  isExternal: false,
  isNetwork: false,
  writable: true,
  totalBytes: 100,
  freeBytes: 50,
};

describe("Explorer sidebar devices", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores devices hidden by the retired fake unmount action", () => {
    const entries = buildDeviceEntries([startupDisk], {
      nameOverrides: {},
      hiddenPaths: ["/"],
      customMountPaths: [],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.mountPath).toBe("/");
  });

  it("clears legacy hidden device paths when preferences load", () => {
    window.localStorage.setItem(
      "misty.explorer.sidebar.devices",
      JSON.stringify({ hiddenPaths: ["/", "/Volumes/Backup"] }),
    );

    expect(loadDeviceCustomization().hiddenPaths).toEqual([]);
  });
});
