import { spacesApi } from "@/api/spaces/api";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearUsageCache } from "../store/usageCache";

const { SpaceUsagePopover } = await import("../components/SpaceUsagePopover");

const space: Space = {
  id: "space-1",
  is_default: false,
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

  it("defers storage requests until the gauge is opened", async () => {
    const storage = vi.spyOn(spacesApi, "libraryUsage");
    const agent = vi.spyOn(spacesApi, "agentUsage");

    await act(async () => root.render(<SpaceUsagePopover space={space} />));

    // Collapsed, this is one icon — no quota text and no requests.
    expect(container.querySelector('button[aria-label="Usage"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("AI usage");
    expect(storage).not.toHaveBeenCalled();
    expect(agent).not.toHaveBeenCalled();
  });

  it("loads only storage without requesting account AI usage", async () => {
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
    const agent = vi.spyOn(spacesApi, "agentUsage");

    await act(async () => root.render(<SpaceUsagePopover space={space} />));
    await open();

    const text = document.body.textContent ?? "";
    expect(agent).not.toHaveBeenCalled();
    expect(text).toContain("Storage");
    expect(text).toContain("1.5 MB / 50 GB");
    expect(text).not.toContain("Personal");
    expect(text).not.toContain("AI");
    expect(text).not.toContain("allowance");
    expect(text).not.toContain("Provided by");
    expect(document.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  });

  it("does not present a legacy placeholder as an unlimited allowance", async () => {
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
        limit_bytes: Number.MAX_SAFE_INTEGER,
        remaining_bytes: Number.MAX_SAFE_INTEGER,
      },
    });

    await act(async () => root.render(<SpaceUsagePopover space={space} />));
    await open();

    expect(document.body.textContent).toContain("0 B / —");
    expect(document.body.textContent).not.toContain("Unlimited");
    expect(document.body.textContent).not.toContain("9007.2 TB");
    expect(
      document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
    ).toBeNull();
    expect(document.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  });

  it("reuses cached storage when reopened without fetching AI usage", async () => {
    const librarySpy = vi.spyOn(spacesApi, "libraryUsage").mockResolvedValue({
      space_id: "space-1",
      space_used_bytes: 1000,
      used_bytes: 1000,
      limit_bytes: 10000,
      remaining_bytes: 9000,
      storage_available: true,
    });
    const agentSpy = vi.spyOn(spacesApi, "agentUsage");

    await act(async () => root.render(<SpaceUsagePopover space={space} />));
    await open();

    expect(librarySpy).toHaveBeenCalledTimes(1);
    expect(agentSpy).not.toHaveBeenCalled();

    // Close, then reopen: the storage response remains cached.
    await open();
    await open();
    expect(librarySpy).toHaveBeenCalledTimes(1);
    expect(agentSpy).not.toHaveBeenCalled();
  });
});
