import {
  navigationTreeContentInsetClass,
  navigationTreeIconClass,
  navigationTreeSurfaceClass,
} from "@/shared/ui";
import type { MountedDevice } from "@/native/ipc";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeviceEntries,
  loadDeviceCustomization,
  sidebarStyles,
} from "./ExplorerSidebarSupport";

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
    expect(sidebarStyles.quickAccessSurface).toContain("group-hover/tree-row:bg-charcoal-card");
    expect(sidebarStyles.quickAccessSurface).toContain("group-hover/tree-row:text-cream-bright");
  });

  it("keeps branch content close to the connector line", () => {
    expect(sidebarStyles.treeSurface).toContain(navigationTreeSurfaceClass);
    expect(sidebarStyles.itemButton).toContain(navigationTreeContentInsetClass);
    expect(sidebarStyles.pinnedButton).toContain(navigationTreeContentInsetClass);
    expect(sidebarStyles.deviceButton).toContain(navigationTreeContentInsetClass);
    expect(sidebarStyles.deviceGroupToggle).toContain(navigationTreeContentInsetClass);
  });

  it("uses prominent icons throughout sidebar item rows", () => {
    expect(sidebarStyles.itemIcon).toContain(navigationTreeIconClass);
    expect(sidebarStyles.itemIcon).toContain(navigationTreeIconClass);
    expect(sidebarStyles.remoteIcon).toContain(navigationTreeIconClass);
    expect(sidebarStyles.deviceIcon).toContain(navigationTreeIconClass);
  });
});
