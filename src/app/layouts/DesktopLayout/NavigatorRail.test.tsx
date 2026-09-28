import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigatorRail } from "./NavigatorRail";

const native = vi.hoisted(() => ({ tracking: vi.fn(), suspend: vi.fn() }));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserPointerTrackingEnabled: native.tracking,
  setBrowserWebviewsSuspended: native.suspend,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const content = (
  <nav aria-label="Primary">
    <button>Agents</button>
  </nav>
);
const rail = () => document.querySelector<HTMLElement>(".misty-docking-nav")!;
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
};

describe("fixed-width navigation rail", () => {
  it("stays visible at its fixed width when pinned", async () => {
    render(
      <NavigatorRail autoHide={false} position="left">
        {content}
      </NavigatorRail>,
    );
    expect(rail().style.width).toBe("56px");
    expect(rail().hasAttribute("inert")).toBe(false);
    expect(screen.queryByRole("button", { name: "Show navigation" })).toBeNull();
    fireEvent.pointerLeave(rail());
    await settle();
    expect(rail().getAttribute("aria-hidden")).toBe("false");
  });

  it("reveals on edge hover and hides after leaving without unmounting contents", async () => {
    render(
      <NavigatorRail autoHide position="left">
        {content}
      </NavigatorRail>,
    );
    const element = rail();
    expect(element.hasAttribute("inert")).toBe(true);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Show navigation" }));
    fireEvent.pointerEnter(element);
    expect(element.hasAttribute("inert")).toBe(false);
    expect(native.suspend).toHaveBeenLastCalledWith(true, "navigator-reveal");
    fireEvent.pointerLeave(element);
    await settle();
    expect(rail()).toBe(element);
    expect(element.hasAttribute("inert")).toBe(true);
    expect(element.style.width).toBe("56px");
    expect(native.suspend).toHaveBeenLastCalledWith(false, "navigator-reveal");
  });

  it("keeps a menu anchor visible until its portaled menu closes", async () => {
    const view = (open: boolean) => (
      <NavigatorRail autoHide position="left">
        <button aria-haspopup="menu" aria-expanded={open}>
          Menu
        </button>
      </NavigatorRail>
    );
    const { rerender } = render(view(false));
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Show navigation" }));
    rerender(view(true));
    fireEvent.pointerLeave(rail());
    await settle();
    expect(rail().hasAttribute("inert")).toBe(false);
    rerender(view(false));
    await settle();
    expect(rail().hasAttribute("inert")).toBe(true);
  });

  it("reveals for native browser pointer events and cleans up tracking", () => {
    const { unmount } = render(
      <NavigatorRail autoHide position="left">
        {content}
      </NavigatorRail>,
    );
    vi.spyOn(
      screen.getByRole("button", { name: "Show navigation" }),
      "getBoundingClientRect",
    ).mockReturnValue({
      left: 0,
      right: 8,
      top: 38,
      bottom: 720,
      width: 8,
      height: 682,
      x: 0,
      y: 38,
      toJSON: () => ({}),
    });
    act(() =>
      window.dispatchEvent(new CustomEvent("misty:browser-pointer", { detail: { x: 3, y: 200 } })),
    );
    expect(rail().hasAttribute("inert")).toBe(false);
    expect(native.tracking).toHaveBeenCalledWith(true);
    unmount();
    expect(native.tracking).toHaveBeenLastCalledWith(false);
    expect(native.suspend).toHaveBeenLastCalledWith(false, "navigator-reveal");
  });

  it("lets keyboard users reveal the rail and Escape back to the toggle", async () => {
    render(
      <>
        <button data-navigator-visibility-toggle>Auto-hide navigation</button>
        <NavigatorRail autoHide position="left">
          {content}
        </NavigatorRail>
      </>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "Show navigation" }));
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Agents" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(rail().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Auto-hide navigation" }),
    );
  });
});
