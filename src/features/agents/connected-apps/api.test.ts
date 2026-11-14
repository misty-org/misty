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

it("runs the apps page and its cards on this computer", async () => {
  await appsApi.list();
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_apps_list", undefined);
  await appsApi.connect("gmail");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_apps_connect", { app: "gmail" });
  await appsApi.decide("localapprq_1", "remember");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_request_decide", {
    id: "localapprq_1",
    decision: "remember",
  });
  await appsApi.request("localapprq_1");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_request_get", { id: "localapprq_1" });
  await appsApi.requestLink("localapprq_1");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_request_link", { id: "localapprq_1" });
  expect(mocks.apiRequest).not.toHaveBeenCalled();
  expect(mocks.cachedRequest).not.toHaveBeenCalled();
});

it("calls every page action natively on the local path, and explains a refusal", async () => {
  await localAppsApi.list();
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_apps_list", undefined);
  await localAppsApi.catalog("gm");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_apps_catalog", {
    search: "gm",
    cursor: "",
  });
  await localAppsApi.connect("gmail");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_apps_connect", { app: "gmail" });
  await localAppsApi.disconnect("ca_1");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_apps_disconnect", { id: "ca_1" });
  mocks.invoke.mockRejectedValue({
    code: "apps_rejected",
    message: "Composio said no.",
    uncertain: false,
  });
  await expect(localAppsApi.connect("gmail")).rejects.toThrow("Composio said no.");
  mocks.invoke.mockRejectedValue("ipc closed");
  await expect(localAppsApi.connect("gmail")).rejects.toThrow("That didn’t go through. Try again.");
});

it("revokes a remembered approval where it lives", async () => {
  await grantsApi.revoke("localgrant_1");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_grants_revoke", { id: "localgrant_1" });
  await grantsApi.revokeAll("this_computer");
  expect(mocks.invoke).toHaveBeenLastCalledWith("composio_grants_revoke", { id: null });
  expect(mocks.apiRequest).not.toHaveBeenCalled();
});
