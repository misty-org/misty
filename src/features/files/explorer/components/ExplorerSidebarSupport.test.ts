import type { MountedDevice } from "@/native/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeviceEntries,
  loadDeviceCustomization,
  sidebarStyles,
} from "../components/ExplorerSidebarSupport";

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

describe("Explorer sidebar interaction styles", () => {
  it("uses a clearly elevated Quick access hover surface", () => {
    expect(sidebarStyles.quickAccessSurface).toContain("group-hover/tree-row:bg-charcoal-hover");
    expect(sidebarStyles.quickAccessSurface).toContain("group-hover/tree-row:text-cream-bright");
  });

  it("keeps branch content close to the connector line", () => {
    expect(sidebarStyles.treeSurface).toContain("ml-1");
    expect(sidebarStyles.itemButton).toContain("pl-1");
    expect(sidebarStyles.pinnedButton).toContain("pl-1");
    expect(sidebarStyles.deviceButton).toContain("pl-1");
    expect(sidebarStyles.deviceGroupToggle).toContain("pl-1");
  });

  it("uses prominent icons throughout sidebar item rows", () => {
    expect(sidebarStyles.itemIcon).toContain("size-7");
    expect(sidebarStyles.itemIcon).toContain("[&_svg]:!size-5");
    expect(sidebarStyles.remoteIcon).toContain("[&_img]:!size-5");
    expect(sidebarStyles.deviceIcon).toContain("[&_svg]:!size-5");
  });
});
