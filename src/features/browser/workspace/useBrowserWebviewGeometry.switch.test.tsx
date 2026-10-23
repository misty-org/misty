import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  sync: vi.fn().mockResolvedValue(undefined),
  layout: vi.fn(),
  hide: vi.fn(),
  prewarm: vi.fn().mockResolvedValue(undefined),
  created: true,
  presented: {} as Record<string, boolean>,
  listeners: new Set<() => void>(),
}));
// Other features the hook pulls in (the workspace store) keep the real runtime's other exports.
vi.mock("@/features/webviews/browserRuntime", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  browserRuntimeResumeEvent: "misty:browser-runtime-resume",
  windowChromeChangedEvent: "misty:window-chrome-changed",
  syncBrowserWebview: runtime.sync,
  requestBrowserWebviewLayout: runtime.layout,
  hideBrowserWebview: runtime.hide,
  prewarmBrowserWebview: runtime.prewarm,
  isBrowserRuntimeCreated: () => runtime.created,
  isBrowserLayoutMoving: () => false,
  useBrowserRuntimeStore: {
    getState: () => ({ errors: {}, setError: vi.fn(), presented: runtime.presented }),
    subscribe: (listener: () => void) => {
      runtime.listeners.add(listener);
      return () => void runtime.listeners.delete(listener);
    },
  },
}));
vi.mock("@/shared/hooks/useAppZoom", () => ({
  appZoomChangedEvent: "misty:app-zoom-changed",
  getAppliedAppRenderScale: () => 1,
}));
import { useBrowserWebviewGeometry } from "./useBrowserWebviewGeometry";
import {
  useWorkspaceStore,
  type WorkspaceLayout,
  type WorkspacePane,
  type WorkspaceView,
} from "@/features/workspace";

const pane = (id: string, viewId: string, surfaceId: string): WorkspacePane => ({
  type: "leaf",
  id,
  views: [{ id: viewId, surfaceId } as WorkspaceView],
  activeViewId: viewId,
});
const showing = (root: WorkspacePane): WorkspaceLayout => ({ root, focusedPaneId: root.id });

const tab = { id: "page", instanceKey: "page" } as WorkspaceView;
const frames: FrameRequestCallback[] = [];
let initial: ReturnType<typeof useWorkspaceStore.getState>["layout"];

beforeEach(() => {
  initial = useWorkspaceStore.getState().layout;
  useWorkspaceStore.setState({ layout: showing(pane("a", "page", "browser")) });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  frames.length = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState({ layout: initial });
  runtime.presented = {};
  runtime.listeners.clear();
  runtime.hide.mockClear();
  runtime.prewarm.mockClear();
  runtime.created = true;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = () =>
  renderHook(() =>
    useBrowserWebviewGeometry({
      hostRef: { current: document.createElement("div") },
      nativeRuntime: true,
      nativeLiveResize: false,
      tab,
      url: "https://example.com",
      theme: "dark",
    }),
  );

it("hides the page in the same tick as a switch to a tab without a browser", () => {
  mount();
  useWorkspaceStore.setState({ layout: showing(pane("b", "home", "space")) });
  // No frame has run: the hide does not wait for the host's size observer.
  expect(runtime.hide).toHaveBeenCalledTimes(1);
  expect(runtime.hide).toHaveBeenCalledWith(tab);
  // Later layout changes elsewhere hide nothing more.
  useWorkspaceStore.setState({ layout: showing(pane("c", "files", "files")) });
  expect(runtime.hide).toHaveBeenCalledTimes(1);
});

it("leaves a switch to another browser tab to the handoff", () => {
  mount();
  useWorkspaceStore.setState({ layout: showing(pane("b", "other", "browser")) });
  expect(runtime.hide).not.toHaveBeenCalled();
});

it("keeps the page while its view stays in front", () => {
  mount();
  useWorkspaceStore.setState({ layout: showing(pane("a", "page", "browser")) });
  expect(runtime.hide).not.toHaveBeenCalled();
});

it("loads a tab's page in the background before it is shown, at the shown page's size", async () => {
  runtime.created = false;
  const shown = document.createElement("div");
  shown.dataset.workspacePane = "b";
  shown.getBoundingClientRect = () =>
    ({ left: 10, top: 50, right: 810, bottom: 650, width: 800, height: 600 }) as DOMRect;
  document.body.append(shown);
  // Signed in, on a page of the workspace.
  window.history.replaceState(null, "", "/browser");
  // The tab's own host is hidden: an inactive tab in the panel.
  mount();
  frames.splice(0).forEach((callback) => callback(0));
  expect(runtime.prewarm).not.toHaveBeenCalled();
  // It waits for the page in front to be drawn, then for the app to be idle.
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(runtime.prewarm).not.toHaveBeenCalled();
  runtime.presented = { front: true };
  runtime.listeners.forEach((listener) => listener());
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(runtime.prewarm).toHaveBeenCalledTimes(1);
  expect(runtime.prewarm).toHaveBeenCalledWith(
    expect.objectContaining({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 50, width: 800, height: 600 },
    }),
  );
  shown.remove();
  window.history.replaceState(null, "", "/");
});

it("leaves a page that already exists alone", async () => {
  window.history.replaceState(null, "", "/browser");
  mount();
  frames.splice(0).forEach((callback) => callback(0));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(runtime.prewarm).not.toHaveBeenCalled();
});
