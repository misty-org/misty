import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  accountId: "a",
  generation: 1,
  transitioning: false,
  request: vi.fn(),
}));
vi.mock("@/api/client", () => ({ apiRequest: fixture.request }));
vi.mock("@/api/client/session", () => ({
  readApiSessionGeneration: () => fixture.generation,
  isApiSessionTransitioning: () => fixture.transitioning,
}));
vi.mock("@/features/auth/core", () => ({
  useUserStore: { getState: () => ({ me: { id: fixture.accountId } }) },
}));
import { assertMistyAvailable } from "./availability";
beforeEach(() => {
  fixture.accountId = "a";
  fixture.generation = 1;
  fixture.transitioning = false;
  fixture.request.mockReset().mockResolvedValue({ id: "a" });
});
it("admits a verified account without consulting Spaces or app installations", async () => {
  await assertMistyAvailable("a");
  expect(fixture.request).toHaveBeenCalledExactlyOnceWith("/me");
});
it("rejects account changes and transitions before starting a request", async () => {
  await expect(assertMistyAvailable("b")).rejects.toThrow(/account changed/);
  fixture.transitioning = true;
  await expect(assertMistyAvailable("a")).rejects.toThrow(/account changed/);
  expect(fixture.request).not.toHaveBeenCalled();
});
it("rejects a switched-away-and-back session and a mismatched server identity", async () => {
  fixture.request.mockImplementation(async () => {
    fixture.generation += 1;
    return { id: "a" };
  });
  await expect(assertMistyAvailable("a")).rejects.toThrow(/account changed/);
  fixture.request.mockResolvedValue({ id: "b" });
  await expect(assertMistyAvailable("a")).rejects.toThrow(/account changed/);
});
