import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceView } from "@/features/workspace";
import { useBrowserMediaStore } from "./mediaStore";
import { closeBrowserRuntime, syncBrowserWebview } from "@/features/webviews/browserRuntime";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("mediaStore", () => {
  beforeEach(() => {
    useBrowserMediaStore.setState({ audible: {}, muted: {} });
    invoke.mockClear();
  });

  it("sets audible and muted state and cleans up on runtime close", async () => {
    const tab = {
      id: "media-tab",
      instanceKey: "media-key",
      surfaceId: "browser",
      title: "Media Tab",
    } as WorkspaceView;

    useBrowserMediaStore.getState().setAudible(tab.id, true);
    useBrowserMediaStore.getState().setMutedState(tab.id, true);

    expect(useBrowserMediaStore.getState().audible[tab.id]).toBe(true);
    expect(useBrowserMediaStore.getState().muted[tab.id]).toBe(true);

    await syncBrowserWebview({
      tab,
      url: "https://example.com/audio",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      theme: "dark",
    });

    await closeBrowserRuntime(tab, () => true);

    expect(useBrowserMediaStore.getState().audible[tab.id]).toBeUndefined();
    expect(useBrowserMediaStore.getState().muted[tab.id]).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("browser_webview_close", {
      request: { id: "tab-media-key" },
    });
  });
});
