import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClient from "@/api/client";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: mocks.apiRequest,
}));
import { ApiRequestError } from "@/api/client";

import { homeApi } from "./api";

describe("homeApi", () => {
  it("loads and records account-scoped Home data", async () => {
    mocks.apiRequest.mockResolvedValue({ activity: {}, recent_apps: [] });

    await homeApi.snapshot("space/one");
    await homeApi.recordVisit("space/one", "2026-08-28");
    await homeApi.recordAppActivity("browser");

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/spaces/space%2Fone/home", undefined);
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/spaces/space%2Fone/home/visits", {
      method: "POST",
      body: JSON.stringify({ date: "2026-08-28" }),
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, "/me/home/apps", {
      method: "POST",
      body: JSON.stringify({ app_id: "browser" }),
    });
  });
  it("loads and records global Home without a Space identifier", async () => {
    await homeApi.snapshot();
    await homeApi.recordVisit(undefined, "2026-09-17");
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/me/home", undefined);
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/me/home/visits", {
      method: "POST",
      body: JSON.stringify({ date: "2026-09-17" }),
    });
  });
});

beforeEach(() => {
  mocks.apiRequest.mockReset();
});

it("uses legacy account-wide history once when global Home is not deployed", async () => {
  const snapshot = { activity: { "2026-09-17": 12 }, recent_apps: ["planner"] };
  mocks.apiRequest
    .mockRejectedValueOnce(new ApiRequestError("Not found", 404))
    .mockResolvedValueOnce(snapshot);
  expect(await homeApi.snapshot(undefined, "space/one")).toEqual(snapshot);
  expect(mocks.apiRequest).toHaveBeenLastCalledWith("/spaces/space%2Fone/home", undefined);
  expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
});

it("records a visit through the legacy route on older servers", async () => {
  mocks.apiRequest
    .mockRejectedValueOnce(new ApiRequestError("Not found", 404))
    .mockResolvedValueOnce({ activity: {}, recent_apps: [] });
  await homeApi.recordVisit(undefined, "2026-09-17", "space/one");
  expect(mocks.apiRequest).toHaveBeenLastCalledWith("/spaces/space%2Fone/home/visits", {
    method: "POST",
    body: JSON.stringify({ date: "2026-09-17" }),
  });
});

it.each([401, 403, 500])("does not retry activity writes on status %s", async (status) => {
  const error = new ApiRequestError("Failed", status);
  mocks.apiRequest.mockReset().mockRejectedValue(error);
  await expect(homeApi.recordVisit(undefined, "2026-09-17", "space-one")).rejects.toBe(error);
  expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
});
