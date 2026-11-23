import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settleDeviceSettings } from "@/tests/fake_device_settings";
import { MistyPanelDock } from "./MistyPanelDock";
import { remCss } from "@misty/ui";
import {
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_WIDTH,
  useMistyPanelStore,
} from "./misty_panel_store";

const suspend = vi.hoisted(() => vi.fn());
const db = await vi.hoisted(async () =>
  (await import("@/tests/fake_device_settings")).fakeDeviceSettings(),
);
vi.mock("@/shared/platform/native_invoke", () => ({ invoke: db.invoke }));
vi.mock("@/features/app-windows/page-runtime/browser_overlay_runtime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setBrowserWebviewsSuspended: suspend,
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useMistyPanelStore.setState({ chatOpen: false, width: MISTY_PANEL_WIDTH });
  localStorage.clear();
  suspend.mockClear();
});

const pointer = (target: EventTarget, type: string, at: { clientX?: number; clientY?: number }) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...at }));
  });

const chat = <aside data-testid="chat" />;

describe("Chat panel width", () => {
  it("keeps the width within bounds", () => {
    useMistyPanelStore.getState().setWidth(10);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MIN_WIDTH);
    useMistyPanelStore.getState().setWidth(5_000);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MAX_WIDTH);
  });

  it("follows the pointer: dragging toward the page widens the panel", async () => {
    render(<MistyPanelDock views={["chat"]} side="right" chat={chat} />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const edge = screen.getByRole("separator", { name: "Resize chat panel" });
    pointer(edge, "pointerdown", { clientX: 600 });
    expect(edge.dataset.dragging).toBe("true");
    expect(suspend).toHaveBeenLastCalledWith(true, "misty-panel-resize");
    pointer(window, "pointermove", { clientX: 500 });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH + 100);
    const dock = edge.closest<HTMLElement>("[data-misty-panel-dock]")!;
    expect(dock.style.width).toBe(remCss(MISTY_PANEL_WIDTH + 100 + 6));
    expect(dock.style.transitionDuration).toBe("");
    pointer(window, "pointermove", { clientX: 640 });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH - 40);
    pointer(window, "pointerup", { clientX: 640 });
    expect(edge.dataset.dragging).toBeUndefined();
    expect(suspend).toHaveBeenLastCalledWith(false, "misty-panel-resize");
    pointer(window, "pointermove", { clientX: 100 });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH - 40);
  });

  it("resizes from the panel's inner edge", () => {
    render(<MistyPanelDock views={["chat"]} side="right" chat={chat} />);
    const edge = screen.getByRole("separator", { name: "Resize chat panel" });
    act(() => {
      fireEvent.keyDown(edge, { key: "ArrowLeft" });
    });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH + 16);
    act(() => {
      fireEvent.keyDown(edge, { key: "ArrowRight", shiftKey: true });
    });
    expect(useMistyPanelStore.getState().width).toBe(
      Math.max(MISTY_PANEL_MIN_WIDTH, MISTY_PANEL_WIDTH + 16 - 64),
    );
    act(() => {
      fireEvent.doubleClick(edge);
    });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH);
    const card = screen.getByTestId("chat").closest<HTMLElement>("[data-misty-panel-card]")!;
    expect(card.style.getPropertyValue("--misty-panel-width")).toBe(remCss(MISTY_PANEL_WIDTH));
  });

  it("remembers its width and whether it is open on this device, once a drag rests", async () => {
    await settleDeviceSettings();
    db.reset();
    vi.useFakeTimers();
    useMistyPanelStore.getState().setWidth(470);
    useMistyPanelStore.getState().setWidth(480);
    useMistyPanelStore.getState().toggle();
    expect(useMistyPanelStore.getState().width).toBe(480);
    expect(db.read("misty-panel")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    await settleDeviceSettings();
    expect(db.read("misty-panel")).toEqual({ chatOpen: true, width: 480 });
  });
});

describe("Chat panel", () => {
  it("closes when its edge is pulled well past its narrowest", () => {
    useMistyPanelStore.setState({ chatOpen: true });
    render(<MistyPanelDock views={["chat"]} side="right" chat={chat} />);
    const edge = screen.getByRole("separator", { name: "Resize chat panel" });
    pointer(edge, "pointerdown", { clientX: 600 });
    pointer(window, "pointermove", { clientX: 600 + MISTY_PANEL_WIDTH });
    expect(useMistyPanelStore.getState().chatOpen).toBe(false);
    expect(suspend).toHaveBeenLastCalledWith(false, "misty-panel-resize");
  });
});
