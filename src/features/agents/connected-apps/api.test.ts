import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  apiRequest: vi.fn(),
  cachedRequest: vi.fn(),
}));
vi.mock("@/shared/platform/nativeInvoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/api/client", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("@/api/cache/cached-request", () => ({ cachedRequest: mocks.cachedRequest }));

import { grantsApi } from "../grants/api";
import { appsApi } from "./api";
import { localAppsApi } from "./localApi";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.apiRequest.mockReset();
  mocks.cachedRequest.mockReset();
  mocks.invoke.mockResolvedValue({});
  mocks.apiRequest.mockResolvedValue({});
  mocks.cachedRequest.mockResolvedValue({ grants: [] });
});

it("runs the cards on this computer", async () => {
  await appsApi.decide("localapprq_1", "remember");
  expect(mocks.invoke).toHaveBeenLastCalledWith("apps_request_decide", {
    id: "localapprq_1",
    decision: "remember",
  });
  await appsApi.request("localapprq_1");
  expect(mocks.invoke).toHaveBeenLastCalledWith("apps_request_get", { id: "localapprq_1" });
  expect(mocks.apiRequest).not.toHaveBeenCalled();
  expect(mocks.cachedRequest).not.toHaveBeenCalled();
});

it("explains a refusal", async () => {
  mocks.invoke.mockRejectedValue({ code: "apps_storage", message: "No.", uncertain: false });
  await expect(localAppsApi.request("x")).rejects.toThrow("No.");
  mocks.invoke.mockRejectedValue("ipc closed");
  await expect(localAppsApi.request("x")).rejects.toThrow("That didn’t go through. Try again.");
});

it("revokes a remembered approval where it lives", async () => {
  await grantsApi.revoke("localgrant_1");
  expect(mocks.invoke).toHaveBeenLastCalledWith("apps_grants_revoke", { id: "localgrant_1" });
  await grantsApi.revokeAll("this_computer");
  expect(mocks.invoke).toHaveBeenLastCalledWith("apps_grants_revoke", { id: null });
  expect(mocks.apiRequest).not.toHaveBeenCalled();
});
