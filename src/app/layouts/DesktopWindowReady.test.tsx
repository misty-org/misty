import type * as AppZoom from "@/shared/hooks/useAppZoom";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import macosConfig from "../../../src-tauri/tauri.macos.conf.json";
import { App } from "../App";
import { DesktopWindowReady } from "./DesktopWindowReady";
const mocks = vi.hoisted(() => ({
  reveal: vi.fn(),
  zoom: vi.fn(),
  platform: vi.fn(),
  background: vi.fn(),
  theme: "#131313",
}));
vi.mock("@/features/settings", () => ({
  extensionThemeChangedEvent: "misty://extension-theme-changed",
  extensionThemeSnapshot: () => ({
    tokens: {
      background: mocks.theme,
    },
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setBackgroundColor: mocks.background,
  }),
}));
vi.mock("@/native", () => ({
  revealMainWindow: mocks.reveal,
}));
vi.mock("@/shared/hooks/useAppZoom", async (importOriginal) => {
  const actual = await importOriginal<typeof AppZoom>();
  return {
    ...actual,
    getAppliedAppZoom: () => 1.4,
    getAppliedAppRenderScale: () => actual.appZoomRenderScale(1.4),
  };
});
vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    setZoom: mocks.zoom,
  }),
}));
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: mocks.platform,
}));
// No onboarding or route content has mounted yet.
vi.mock("../router", () => ({
  AppRouter: () => null,
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.platform.mockReturnValue("macos");
  mocks.zoom.mockResolvedValue(undefined);
  mocks.background.mockResolvedValue(undefined);
  mocks.theme = "#131313";
  mocks.reveal.mockResolvedValue(undefined);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("main window readiness", () => {
  it("keeps the native macOS window hidden until the positioned reveal", () => {
    expect(macosConfig.app.windows[0].visible).toBe(false);
  });
  it("prepares the window from the app root even before a route renders", async () => {
    render(<App />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.zoom).toHaveBeenCalledWith(1.54);
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
  });
  it("matches the native background on launch and theme changes, then cleans up", async () => {
    const view = render(<DesktopWindowReady />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.background).toHaveBeenLastCalledWith("#131313");
    mocks.theme = "#fafafa";
    await act(async () => {
      window.dispatchEvent(new Event("misty://extension-theme-changed"));
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(mocks.background).toHaveBeenLastCalledWith("#fafafa");
    expect(mocks.background.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reveal.mock.invocationCallOrder[0],
    );
    view.unmount();
    mocks.background.mockClear();
    window.dispatchEvent(new Event("misty://extension-theme-changed"));
    expect(mocks.background).not.toHaveBeenCalled();
  });
  it("waits for fonts, saved zoom, and the committed layout before revealing", async () => {
    const onZoom = vi.fn();
    window.addEventListener("misty:app-zoom-changed", onZoom);
    let fontsReady!: () => void;
    let zoomReady!: () => void;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: new Promise<void>((resolve) => {
          fontsReady = resolve;
        }),
      },
    });
    mocks.zoom.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          zoomReady = resolve;
        }),
    );
    render(<DesktopWindowReady />);
    expect(mocks.zoom).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
    await act(async () => {
      fontsReady();
    });
    expect(mocks.zoom).toHaveBeenCalledWith(1.54);
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(onZoom).not.toHaveBeenCalled();
    await act(async () => {
      zoomReady();
    });
    expect(onZoom).toHaveBeenCalledTimes(1);
    window.removeEventListener("misty:app-zoom-changed", onZoom);
    expect(mocks.reveal).not.toHaveBeenCalled();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
  });
  it("does not reveal a screen that unmounted while loading", async () => {
    const view = render(<DesktopWindowReady />);
    view.unmount();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.reveal).not.toHaveBeenCalled();
  });
  it("still uses the positioned native reveal if restoring zoom fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.zoom.mockRejectedValueOnce(new Error("zoom failed"));
    render(<DesktopWindowReady />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
  });
  it("leaves other platforms' window visibility alone", async () => {
    mocks.platform.mockReturnValue("windows");
    render(<DesktopWindowReady />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(mocks.zoom).not.toHaveBeenCalled();
  });
});
