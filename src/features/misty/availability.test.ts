import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  accountId: "a",
  native: true,
  ready: true,
  installations: vi.fn(),
}));
vi.mock("@/api/apps", () => ({ appsApi: { installations: fixture.installations } }));
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
it("requires both Space enablement and a local package on desktop", async () => {
  await expect(assertMistyAvailable("a", "s")).resolves.toBeUndefined();
  fixture.ready = false;
  await expect(assertMistyAvailable("a", "s")).rejects.toThrow(/Install/);
  fixture.ready = true;
  fixture.installations.mockResolvedValue({ apps: [] });
  await expect(assertMistyAvailable("a", "s")).rejects.toThrow(/Enable Agents/);
});
it("rejects missing Space and identity changes during admission", async () => {
  await expect(assertMistyAvailable("a", "")).rejects.toThrow(/Select a Space/);
  fixture.installations.mockImplementation(async () => {
    fixture.accountId = "b";
    return { apps: [{ app_id: "agents", state: "installed" }] };
  });
  await expect(assertMistyAvailable("a", "s")).rejects.toThrow(/account changed/);
});
