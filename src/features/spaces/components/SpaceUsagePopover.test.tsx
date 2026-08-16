import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ApiClient from "@/api/client";
import type { Space } from "@/api/spaces/dto/interfaces/types";
const api = vi.hoisted(() => ({ request: vi.fn(), generation: 1 }));
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof ApiClient>()),
  apiRequest: api.request,
  readApiSessionGeneration: () => api.generation,
}));
import { SpaceUsagePopover } from "./SpaceUsagePopover";
const space = { id: "space-1", name: "Team" } as Space;
afterEach(() => {
  cleanup();
  api.request.mockReset();
  api.generation = 1;
});
const usage = {
  account: {
    ai: {
      used: 1000,
      reserved: 300,
      limit: 10000000,
      remaining: 9998700,
      percentage_used: 0.01,
      recent_commands: [
        {
          id: "command",
          started_at: "2026-10-03T12:00:00Z",
          used: 750,
          reserved: 300,
          maximum: 1000000,
        },
      ],
    },
    cloud_storage: {
      used_bytes: 1500000,
      reserved_bytes: 0,
      limit_bytes: 5000000000,
      remaining_bytes: 4998500000,
      percentage_used: 0.03,
    },
    sync: {
      used: 100,
      reserved: 0,
      limit: 20000000000,
      remaining: 19999999900,
      percentage_used: 0.0000005,
    },
  },
};
describe("Account usage from a Space", () => {
  it("loads all three account meters only when opened, without a Space request", async () => {
    api.request.mockResolvedValue(usage);
    render(<SpaceUsagePopover space={space} />);
    expect(api.request).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Account usage" }));
    });
    expect(api.request.mock.calls[0][0]).toBe("/billing/usage");
    expect(screen.getByText("Cloud storage")).toBeDefined();
    expect(screen.getByText("Sync transfer")).toBeDefined();
    expect(screen.getByText(/300 weighted tokens temporarily reserved/)).toBeDefined();
    fireEvent.click(screen.getByText("Recent AI commands"));
    expect(screen.getByText("750 weighted tokens used")).toBeDefined();
    expect(screen.getByText("Ceiling: 1,000,000 weighted tokens")).toBeDefined();
  });
  it("shows a recoverable error rather than fabricated zero usage", async () => {
    api.request.mockRejectedValue(new Error("offline"));
    render(<SpaceUsagePopover space={space} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Account usage" }));
    });
    expect(screen.getByText(/Close and reopen to retry/)).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
