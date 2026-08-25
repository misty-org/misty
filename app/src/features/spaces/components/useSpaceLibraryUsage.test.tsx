import { spacesApi } from "@/api/spaces/api";
import type { Space, SpaceStorageUsage } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceLibraryUsage } from "../components/spacePanel/useSpaceLibraryUsage";
import { useSpacesStore } from "../store/useSpacesStore";
import { clearUsageCache } from "../store/usageCache";

const dummySpace1: Space = {
  id: "space-1",
  owner_user_id: "user-1",
  name: "Test Space 1",
  role: "owner",
  member_count: 1,
  pending_count: 0,
  is_shared: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const dummySpace2: Space = {
  id: "space-2",
  owner_user_id: "user-1",
  name: "Test Space 2",
  role: "owner",
  member_count: 1,
  pending_count: 0,
  is_shared: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const dummyUsage: SpaceStorageUsage = {
  space_id: "space-1",
  space_used_bytes: 500000,
  used_bytes: 3000000,
  limit_bytes: 1000000000,
  remaining_bytes: 999500000,
  storage_available: true,
};

function UsageProbe({ spaceId, space }: { spaceId: string; space: Space }) {
  const usage = useSpaceLibraryUsage({
    activeSpaceId: spaceId,
    activeSpace: space,
    snapshotReady: true,
  });
  return (
    <div data-testid="usage">
      {usage ? `${usage.space_id}:${usage.used_bytes}/${usage.limit_bytes}` : "null"}
    </div>
  );
}

describe("useSpaceLibraryUsage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearUsageCache();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    clearUsageCache();
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("fetches library usage when viewing non-library sections like notes", async () => {
    const spy = vi.spyOn(spacesApi, "libraryUsage").mockResolvedValue(dummyUsage);

    await act(async () => {
      root.render(<UsageProbe spaceId="space-1" space={dummySpace1} />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(spy).toHaveBeenCalledWith("space-1");
    expect(container.querySelector("[data-testid='usage']")?.textContent).toBe(
      "space-1:500000/1000000000",
    );
  });

  it("extracts unique per-space usage from store ownerStorage breakdown", async () => {
    useSpacesStore.setState({
      ownerStorage: {
        used_bytes: 3000000,
        reserved_bytes: 0,
        limit_bytes: 1000000000,
        remaining_bytes: 997000000,
        spaces: [
          { space_id: "space-1", name: "Space 1", used_bytes: 500000, reserved_bytes: 0 },
          { space_id: "space-2", name: "Space 2", used_bytes: 2500000, reserved_bytes: 0 },
        ],
      },
    });

    vi.spyOn(spacesApi, "libraryUsage").mockResolvedValue(dummyUsage);

    await act(async () => {
      root.render(<UsageProbe spaceId="space-2" space={dummySpace2} />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='usage']")?.textContent).toBe(
      "space-2:2500000/1000000000",
    );
  });

  it("uses the selected Space contribution instead of the repeated owner-pool total", async () => {
    useSpacesStore.setState({ ownerStorage: null });
    vi.spyOn(spacesApi, "libraryUsage").mockResolvedValue({
      space_id: "space-2",
      space_used_bytes: 2500000,
      used_bytes: 3000000,
      limit_bytes: 1000000000,
      remaining_bytes: 997000000,
      storage_available: true,
    });

    await act(async () => {
      root.render(<UsageProbe spaceId="space-2" space={dummySpace2} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='usage']")?.textContent).toBe(
      "space-2:2500000/1000000000",
    );
  });
});
