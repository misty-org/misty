import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  accountId: "a",
  native: true,
  ready: true,
  installations: vi.fn(),
}));
vi.mock("@/api/client", () => ({ apiRequest: fixture.installations }));
vi.mock("@/features/apps/useAppsStore", () => ({
  useAppsStore: {
    getState: () => ({ accountId: fixture.accountId, spaceId: "s", catalog: [{ id: "agents" }] }),
  },
}));
vi.mock("@/features/apps/desktopPackages", () => ({
  officialDesktopPackageReady: async () => fixture.ready,
}));
vi.mock("@/features/spaces/core", () => ({ useSpacesStore: { getState: () => ({}) } }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => fixture.native }));
import { assertMistyAvailable } from "./availability";
beforeEach(() => {
  fixture.accountId = "a";
  fixture.ready = true;
  fixture.native = true;
  fixture.installations.mockResolvedValue({ apps: [{ app_id: "agents", state: "installed" }] });
});
it("works without the downloadable Agents package or Space installation", async () => {
  await expect(assertMistyAvailable("a", "s")).resolves.toBeUndefined();
  fixture.ready = false;
  await expect(assertMistyAvailable("a", "s")).resolves.toBeUndefined();
  fixture.ready = true;
  fixture.installations.mockResolvedValue({ apps: [] });
  await expect(assertMistyAvailable("a", "s")).resolves.toBeUndefined();
});
it("supports account-only work and rejects identity changes during admission", async () => {
  await expect(assertMistyAvailable("a", "")).resolves.toBeUndefined();
  fixture.installations.mockImplementation(async () => {
    fixture.accountId = "b";
    return { apps: [{ app_id: "agents", state: "installed" }] };
  });
  await expect(assertMistyAvailable("a", "s")).rejects.toThrow(/account changed/);
});
