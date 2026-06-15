import { act, render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopWindowReady } from "./DesktopWindowReady";
import { App } from "../App";

const mocks = vi.hoisted(() => ({ reveal: vi.fn(), zoom: vi.fn(), platform: vi.fn() }));
vi.mock("@/native", () => ({ revealMainWindow: mocks.reveal }));
vi.mock("@/shared/hooks/useAppZoom", () => ({ getAppliedAppZoom: () => 1.4 }));
vi.mock("@/shared/platform/buildTarget", () => ({ isNativeMobileBuild: false }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: mocks.zoom }) }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: mocks.platform }));
// No onboarding or route content has mounted yet.
vi.mock("../router", () => ({ AppRouter: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.platform.mockReturnValue("macos");
  mocks.zoom.mockResolvedValue(undefined);
  mocks.reveal.mockResolvedValue(undefined);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("main window readiness", () => {
  it("prepares the window from the app root even before a route renders", async () => {
    render(<App />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.zoom).toHaveBeenCalledWith(1.4);
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
  });
  it("waits for fonts, saved zoom, and the committed layout before revealing", async () => {
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
    expect(mocks.zoom).toHaveBeenCalledWith(1.4);
    expect(mocks.reveal).not.toHaveBeenCalled();
    await act(async () => {
      zoomReady();
    });
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
