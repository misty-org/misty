import { beforeEach, describe, expect, it, vi } from "vitest";
type View = {
  id: string;
  surfaceId: string;
  title: string;
  state?: { url: string };
  lastFocusedAt: number;
};
const mocks = vi.hoisted(() => ({
  views: [] as View[],
  focused: null as View | null,
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
      openBrowserView: mocks.open,
    }),
  },
}));
vi.mock("@/features/workspace/layoutTabs", () => ({
  allLayoutViews: () => mocks.views,
  activeLayoutView: () => mocks.focused,
}));
vi.mock("@/features/webviews/browserRuntime", () => ({
  browserRuntimeCreated: mocks.created,
  browserScopeId: (tab: { id: string }) => `scope:${tab.id}`,
}));
vi.mock("../store/useAgentDeviceStore", () => ({ ensureServerAgentDevice: mocks.device }));
vi.mock("../store/useAgentsStore", () => ({ agentsDeviceSnapshot: mocks.snapshot }));
import { companionBrowserContext } from "./normalTabs";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.views = [];
  mocks.focused = null;
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
    mocks.views = [
      { id: "other", surfaceId: "browser", title: "Other", lastFocusedAt: 2 },
      { id: "chosen", surfaceId: "browser", title: "Chosen", lastFocusedAt: 1 },
    ];
    mocks.focused = mocks.views[1];
    const result = await companionBrowserContext(() => {});
    expect(result.context[0]).toMatchObject({ id: "chosen", opaqueScopeId: "scope:chosen" });
    expect(result.deviceContexts[0]).toMatchObject({
      deviceId: "server-device",
      opaqueRef: "scope:chosen",
      metadata: { normal_tab: true, tab_id: "chosen" },
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("finds the tab the agent asked for in another window tab", async () => {
    mocks.views = [
      { id: "agents", surfaceId: "agents", title: "Agents", lastFocusedAt: 9 },
      {
        id: "google",
        surfaceId: "browser",
        title: "Google",
        state: { url: "https://www.google.com" },
        lastFocusedAt: 5,
      },
      {
        id: "chess",
        surfaceId: "browser",
        title: "Maria - Play Chess Online",
        state: { url: "https://www.chess.com/play/computer" },
        lastFocusedAt: 3,
      },
    ];
    mocks.focused = mocks.views[0];
    const result = await companionBrowserContext(
      () => {},
      true,
      undefined,
      "play chess in your open chess.com tab",
    );
    expect(result.context[0]).toMatchObject({ id: "chess" });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("falls back to the browser tab the user used most recently", async () => {
    mocks.views = [
      { id: "older", surfaceId: "browser", title: "Docs", lastFocusedAt: 1 },
      { id: "recent", surfaceId: "browser", title: "Mail", lastFocusedAt: 4 },
    ];
    const result = await companionBrowserContext(() => {}, true, undefined, "do the thing");
    expect(result.context[0]).toMatchObject({ id: "recent" });
  });
  it("opens a new tab for new-tab work even when a matching tab is open", async () => {
    mocks.views = [
      {
        id: "mail",
        surfaceId: "browser",
        title: "Mail",
        state: { url: "https://mail.example.com" },
        lastFocusedAt: 3,
      },
    ];
    mocks.focused = mocks.views[0];
    mocks.open.mockReturnValue({ id: "new", surfaceId: "browser", title: "New" });
    const result = await companionBrowserContext(
      () => {},
      true,
      "https://example.com",
      "mail",
      undefined,
      "new",
    );
    expect(mocks.open).toHaveBeenCalledWith({ url: "https://example.com" });
    expect(result.context[0]).toMatchObject({ id: "new" });
  });
  it("binds the tab in front of the user for current-tab work", async () => {
    mocks.views = [
      { id: "chess", surfaceId: "browser", title: "Chess", lastFocusedAt: 1 },
      { id: "mail", surfaceId: "browser", title: "Mail", lastFocusedAt: 4 },
    ];
    mocks.focused = mocks.views[0];
    const result = await companionBrowserContext(
      () => {},
      true,
      undefined,
      "read my mail",
      undefined,
      "current",
    );
    expect(result.context[0]).toMatchObject({ id: "chess" });
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
