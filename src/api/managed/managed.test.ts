import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ http: vi.fn(), invalid: vi.fn(), generation: 1 }));
vi.mock("@/api/client/http", () => ({ httpRequest: mocks.http }));
vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => "https://misty.example/api",
}));
vi.mock("@/api/client/session", () => ({
  apiRequestCredentials: () => "include",
  isApiSessionTransitioning: () => false,
  readApiAuthToken: async () => "",
  readApiSessionGeneration: () => mocks.generation,
  notifyApiSessionInvalid: mocks.invalid,
}));
import { managedAiRequest } from "./managed";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 1;
  mocks.http.mockImplementation(async () => new Response("expired", { status: 401 }));
});
it("signals cookie rejection through the same account validation path", async () => {
  await expect(managedAiRequest("/invocations")).rejects.toMatchObject({ status: 401 });
  expect(mocks.invalid).toHaveBeenCalledOnce();
});
it("keeps independent bearer and cookieless failures out of account validation", async () => {
  await expect(
    managedAiRequest("/invocations", { headers: { Authorization: "Bearer app-token" } }),
  ).rejects.toMatchObject({ status: 401 });
  await expect(managedAiRequest("/invocations", { credentials: "omit" })).rejects.toMatchObject({
    status: 401,
  });
  expect(mocks.invalid).not.toHaveBeenCalled();
});
it("does not invalidate a newer account from a delayed rejection", async () => {
  mocks.http.mockImplementation(async () => {
    mocks.generation++;
    return new Response("expired", { status: 401 });
  });
  await expect(managedAiRequest("/invocations")).rejects.toMatchObject({ code: "account_changed" });
  expect(mocks.invalid).not.toHaveBeenCalled();
});
