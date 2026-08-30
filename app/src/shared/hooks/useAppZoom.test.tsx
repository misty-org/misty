import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setNativeZoom } = vi.hoisted(() => ({
  setNativeZoom: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: setNativeZoom }),
}));

import { appZoomDefault, getAppliedAppZoom, setAppZoom, useAppZoom } from "./useAppZoom";

describe("app zoom", () => {
  afterEach(() => {
    setAppZoom(1);
    window.localStorage.clear();
    document.body.style.zoom = "";
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    setNativeZoom.mockClear();
  });

  it("uses 100% as the product default", () => {
    expect(appZoomDefault).toBe(1);
  });

  it("applies zoom synchronously in the web fallback", () => {
    setAppZoom(0.8);

    expect(getAppliedAppZoom()).toBe(0.8);
    expect(document.body.style.zoom).toBe("0.8");
    expect(document.documentElement.dataset.appZoom).toBe("80");
  });

  it("steps down and resets through the shared hook", () => {
    setAppZoom(1);
    const { result } = renderHook(() => useAppZoom());

    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(0.9);
    expect(document.body.style.zoom).toBe("0.9");

    act(() => result.current.resetZoom());
    expect(result.current.zoom).toBe(1);
    expect(document.body.style.zoom).toBe("1");
  });

  it("uses native page zoom without CSS layout scaling in the desktop app", async () => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: { invoke: () => void } }
    ).__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };
    document.body.style.zoom = "0.5";

    setAppZoom(0.9);

    expect(getAppliedAppZoom()).toBe(0.9);
    expect(document.body.style.zoom).toBe("");
    await waitFor(() => expect(setNativeZoom).toHaveBeenCalledWith(0.9));
  });
});
