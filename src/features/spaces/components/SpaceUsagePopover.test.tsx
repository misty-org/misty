import { spacesApi } from "@/api/spaces/api";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearUsageCache } from "../store/usageCache";

const auth = vi.hoisted(() => ({ userId: "owner" }));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: auth.userId }, transitioning: false }),
}));

const { SpaceUsagePopover } = await import("../components/SpaceUsagePopover");

const space: Space = {
  id: "space-1",
  owner_user_id: "owner",
  name: "Design team",
  role: "owner",
  member_count: 2,
  pending_count: 0,
  is_shared: true,
  created_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:00:00Z",
};

describe("SpaceUsagePopover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    auth.userId = "owner";
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
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const open = async () => {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Usage"]');
    await act(async () => trigger?.click());
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("keeps both quotas out of the sidebar until the gauge is opened", async () => {
    const storage = vi.spyOn(spacesApi, "libraryUsage");
    const agent = vi.spyOn(spacesApi, "agentUsage");

    await act(async () => root.render(<SpaceUsagePopover space={space} />));

    // Collapsed, this is one icon — no quota text and no requests.
    expect(container.querySelector('button[aria-label="Usage"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("AI usage");
    expect(storage).not.toHaveBeenCalled();
    expect(agent).not.toHaveBeenCalled();
  });

  it("loads and shows both quotas once opened", async () => {
    vi.spyOn(spacesApi, "libraryUsage").mockResolvedValue({
      space_id: "space-1",
      personal: {
        used_bytes: 500000000,
        reserved_bytes: 0,
        limit_bytes: 2000000000,
        remaining_bytes: 1500000000,
      },
      space: {
        used_bytes: 1500000,
        reserved_bytes: 0,
        limit_bytes: 50000000000,
        remaining_bytes: 49998500000,
      },
      storage_available: true,
    });
    vi.spyOn(spacesApi, "agentUsage").mockResolvedValue({
      personal: {
        ai: {
          used: 43,
          reserved: 0,
          limit: 100,
          remaining: 57,
          used_ratio: 0.428,
          available: true,
          paused: false,
        },
      },
      spaces: [
        {
          space_id: "space-1",
          name: "Design team",
          role: "owner",
          owner_user_id: "owner",
          ai: {
            used: 20,
            reserved: 0,
            limit: 100,
            remaining: 80,
            used_ratio: 0.2,
            available: true,
            paused: false,
          },
        },
      ],
    });

    await act(async () => root.render(<SpaceUsagePopover space={space} />));
    await open();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Personal AI");
    expect(text).toContain("Space AI");
    expect(text).toContain("43%");
    expect(text).toContain("Personal storage");
    expect(text).toContain("Space storage");
    expect(text).toContain("2 GB");
    expect(text).toContain("50 GB");
    expect(text).toContain("Provided by your plan as this Space’s owner");
  });

  it("explains owner-plan capacity to members", async () => {
    auth.userId = "member";
    vi.spyOn(spacesApi, "libraryUsage").mockResolvedValue({
      space_id: "space-1",
      personal: {
        used_bytes: 0,
        reserved_bytes: 0,
        limit_bytes: 2_000_000_000,
        remaining_bytes: 2_000_000_000,
      },
      space: {
        used_bytes: 0,
        reserved_bytes: 0,
        limit_bytes: 50_000_000_000,
        remaining_bytes: 50_000_000_000,
      },
    });
    vi.spyOn(spacesApi, "agentUsage").mockResolvedValue({
      agent_usage: { percentage_used: 0, available: true, paused: false },
    });

    await act(async () => root.render(<SpaceUsagePopover space={space} />));
    await open();

    expect(document.body.textContent).toContain("Provided by the Space owner’s plan");
  });

  it("uses cached data when reopened and rechecks after 5 minutes", async () => {
    const librarySpy = vi.spyOn(spacesApi, "libraryUsage").mockResolvedValue({
      space_id: "space-1",
      space_used_bytes: 1000,
      used_bytes: 1000,
      limit_bytes: 10000,
      remaining_bytes: 9000,
      storage_available: true,
    });
    const agentSpy = vi.spyOn(spacesApi, "agentUsage").mockResolvedValue({
      agent_usage: { percentage_used: 20, available: true, paused: false },
    });

    await act(async () => root.render(<SpaceUsagePopover space={space} />));
    await open();

    expect(librarySpy).toHaveBeenCalledTimes(1);
    expect(agentSpy).toHaveBeenCalledTimes(1);

    // Reopening does not immediately refetch because data is cached
    await open();
    expect(librarySpy).toHaveBeenCalledTimes(1);
    expect(agentSpy).toHaveBeenCalledTimes(1);
  });
});
