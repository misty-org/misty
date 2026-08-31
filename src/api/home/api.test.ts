import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/api/client", () => ({ apiRequest: mocks.apiRequest }));

import { homeApi } from "./api";

describe("homeApi", () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  it("loads and records account-scoped Home data", async () => {
    mocks.apiRequest.mockResolvedValue({ activity: {}, recent_apps: [] });

    await homeApi.snapshot("space/one");
    await homeApi.recordVisit("space/one", "2026-08-28");
    await homeApi.recordAppActivity("browser");

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/spaces/space%2Fone/home");
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/spaces/space%2Fone/home/visits", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-28" }),
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, "/me/home/apps", {
      method: "POST",
      body: JSON.stringify({ app_id: "browser" }),
    });
  });
});
