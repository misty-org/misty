import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  accountId: "a" as string | undefined,
  savedAccountId: "",
  generation: 1,
  transitioning: false,
  request: vi.fn(),
}));
vi.mock("@/api/client", () => ({ apiRequest: fixture.request }));
vi.mock("@/api/client/session", () => ({
  readApiSessionGeneration: () => fixture.generation,
  isApiSessionTransitioning: () => fixture.transitioning,
}));
vi.mock("@/features/account/core", () => {
  const store = () => undefined;
  store.getState = () => ({
    me: fixture.accountId ? { id: fixture.accountId } : null,
    accountId: fixture.savedAccountId,
  });
  return { useUserStore: store };
});
import { assertMistyAvailable } from "./availability";
beforeEach(() => {
  fixture.accountId = "a";
  fixture.savedAccountId = "";
  fixture.generation = 1;
  fixture.transitioning = false;
  fixture.request.mockReset();
});
it("asks nothing of the server", async () => {
  await assertMistyAvailable("a");
  expect(fixture.request).not.toHaveBeenCalled();
});
it("works from the saved session before the server answers, and never as no one", async () => {
  fixture.accountId = undefined;
  fixture.savedAccountId = "a";
  await expect(assertMistyAvailable("a")).resolves.toBeUndefined();
  fixture.savedAccountId = "";
  await expect(assertMistyAvailable("local")).rejects.toThrow(/account changed/);
});
it("rejects account changes and transitions before starting a request", async () => {
  await expect(assertMistyAvailable("b")).rejects.toThrow(/account changed/);
  fixture.transitioning = true;
  await expect(assertMistyAvailable("a")).rejects.toThrow(/account changed/);
});
