import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  accountId: "a" as string | undefined,
  generation: 1,
  transitioning: false,
  request: vi.fn(),
}));
vi.mock("@/api/client", () => ({ apiRequest: fixture.request }));
vi.mock("@/api/client/session", () => ({
  readApiSessionGeneration: () => fixture.generation,
  isApiSessionTransitioning: () => fixture.transitioning,
}));
vi.mock("@/features/auth/core", () => {
  const store = () => undefined;
  store.getState = () => ({ me: fixture.accountId ? { id: fixture.accountId } : null });
  return { useUserStore: store };
});
import { assertMistyAvailable } from "./availability";
beforeEach(() => {
  fixture.accountId = "a";
  fixture.generation = 1;
  fixture.transitioning = false;
  fixture.request.mockReset();
});
it("asks nothing of the server", async () => {
  await assertMistyAvailable("a");
  expect(fixture.request).not.toHaveBeenCalled();
});
it("works with nobody signed in, under the local scope", async () => {
  fixture.accountId = undefined;
  await expect(assertMistyAvailable("local")).resolves.toBeUndefined();
});
it("rejects account changes and transitions before starting a request", async () => {
  await expect(assertMistyAvailable("b")).rejects.toThrow(/account changed/);
  fixture.transitioning = true;
  await expect(assertMistyAvailable("a")).rejects.toThrow(/account changed/);
});
