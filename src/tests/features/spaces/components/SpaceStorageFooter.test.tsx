import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpaceStorageUsage } from "@/models/interfaces/features/spaces/types";
import {
  formatStorageBytes,
  SpaceStorageFooter,
} from "@/features/spaces/components/spacePanel/SpaceStorageFooter";

describe("SpaceStorageFooter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders space-specific used bytes and pool remaining in the header", async () => {
    const space1Usage: SpaceStorageUsage = {
      space_id: "space-1",
      used_bytes: 2500000, // ~2.38 MB
      limit_bytes: 1000000000,
      remaining_bytes: 997500000,
      storage_available: true,
    };

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceStorageFooter
            usage={space1Usage}
            showsOwnerStorage={true}
          />
        </MemoryRouter>,
      );
    });

    const summaryText = container.querySelector("section")?.textContent;
    expect(summaryText).toContain("2.38 MB in space");
    expect(summaryText).toContain("pool left");
  });

  it("renders quota bar skeletons while loading for owners to prevent layout shifts", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceStorageFooter
            usage={null}
            showsOwnerStorage={true}
          />
        </MemoryRouter>,
      );
    });

    const section = container.querySelector("section");
    expect(section?.textContent).toContain("Checking...");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("formats storage bytes accurately using binary 1024 base with precision", () => {
    expect(formatStorageBytes(1024)).toBe("1 KB");
    expect(formatStorageBytes(1572864)).toBe("1.5 MB");
    expect(formatStorageBytes(2500000)).toBe("2.38 MB");
    expect(formatStorageBytes(1073741824)).toBe("1 GB");
  });
});
