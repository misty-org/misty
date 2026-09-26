import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  panes: [] as Array<{
    id: string;
    activeTabId?: string;
    tabs: Array<{ id: string; surfaceId: string; title: string }>;
  }>,
  open: vi.fn(),
  created: vi.fn(),
  snapshot: vi.fn(),
  device: vi.fn(),
}));
vi.mock("@/features/workspace/browserHome", () => ({
  browserHomeUrl: () => "https://www.google.com",
}));
vi.mock("@/features/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      layout: { root: {}, focusedPaneId: "focused" },
      openBrowserTab: mocks.open,
    }),
  },
}));
vi.mock("@/features/workspace/dockTree", () => ({ dockLeaves: () => mocks.panes }));
vi.mock("@/features/webviews/browserRuntime", () => ({
  browserRuntimeCreated: mocks.created,
  browserScopeId: (tab: { id: string }) => `scope:${tab.id}`,
}));
vi.mock("../store/useAgentDeviceStore", () => ({ ensureServerAgentDevice: mocks.device }));
vi.mock("../store/useAgentsStore", () => ({ agentsDeviceSnapshot: mocks.snapshot }));
import { companionBrowserContext } from "./normalTabs";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.panes = [];
  mocks.created.mockReturnValue(true);
  mocks.snapshot.mockResolvedValue({ device: { id: "local-device", status: "active" } });
  mocks.device.mockResolvedValue({ id: "server-device" });
});
describe("ordinary companion browser tabs", () => {
  it("does not open a browser tab just to answer a question", async () => {
    expect(await companionBrowserContext(() => {})).toEqual({ context: [], deviceContexts: [] });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("targets the focused normal tab with the current account device", async () => {
    mocks.panes = [
      {
        id: "other",
        activeTabId: "other",
        tabs: [{ id: "other", surfaceId: "browser", title: "Other" }],
      },
      {
        id: "focused",
        activeTabId: "chosen",
        tabs: [{ id: "chosen", surfaceId: "browser", title: "Chosen" }],
      },
    ];
    const result = await companionBrowserContext(() => {});
    expect(result.context[0]).toMatchObject({ id: "chosen", opaqueScopeId: "scope:chosen" });
    expect(result.deviceContexts[0]).toMatchObject({
      deviceId: "server-device",
      opaqueRef: "scope:chosen",
      metadata: { normal_tab: true, tab_id: "chosen" },
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("opens a normal tab for delegated work and fences account changes during discovery", async () => {
    mocks.open.mockReturnValue({ id: "new", surfaceId: "browser", title: "New" });
    const assertCurrent = vi.fn();
    mocks.device.mockImplementationOnce(async () => {
      assertCurrent.mockImplementation(() => {
        throw new Error("account changed");
      });
      return { id: "old-device" };
    });
    await expect(companionBrowserContext(assertCurrent, true)).rejects.toThrow("account changed");
    expect(mocks.open).toHaveBeenCalledWith({ url: "https://www.google.com" });
  });
});
