import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMergedTitlebar, windowChromeInsets } from "./useMergedTitlebar";

function Shell({ toolbar = true, enabled = true }: { toolbar?: boolean; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useMergedTitlebar(ref, "right:bottom", enabled, 84, 140);
  return (
    <div ref={ref} data-shell>
      <section data-workspace-pane="left">
        <header data-workspace-titlebar-fallback>Page title</header>
        {toolbar && (
          <header data-window-toolbar data-testid="left">
            Browser controls
          </header>
        )}
      </section>
      <section data-workspace-pane="right">
        <header data-window-toolbar data-testid="right">
          Files controls
        </header>
      </section>
      <section data-workspace-pane="lower">
        <header data-window-toolbar data-testid="lower">
          Lower controls
        </header>
      </section>
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const pane = this.closest<HTMLElement>("[data-workspace-pane]")?.dataset.workspacePane;
    const left = pane === "right" ? 500 : 0;
    const top =
      pane === "lower"
        ? 300
        : this.hasAttribute("data-window-toolbar") &&
            this.parentElement?.hasAttribute("data-window-titlebar-fallback-active")
          ? 38
          : 0;
    const width = this.hasAttribute("data-shell") ? 1000 : 500;
    const height = this.hasAttribute("data-window-toolbar") ? 44 : 300;
    // Simulate application zoom and a shell offset within the viewport.
    return {
      left: left * 1.25 + 10,
      right: (left + width) * 1.25 + 10,
      top: top * 1.25 + 20,
      bottom: (top + height) * 1.25 + 20,
      width: width * 1.25,
      height: height * 1.25,
    } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("only reserves native buttons for overlapping top-edge toolbars, accounting for zoom", () => {
  const { getByTestId } = render(<Shell />);
  expect(getByTestId("left").style.getPropertyValue("--window-chrome-left")).toBe("92px");
  expect(getByTestId("left").style.getPropertyValue("--window-chrome-right")).toBe("0px");
  expect(getByTestId("right").style.getPropertyValue("--window-chrome-left")).toBe("0px");
  expect(getByTestId("right").style.getPropertyValue("--window-chrome-right")).toBe("148px");
  expect(getByTestId("lower").hasAttribute("data-window-chrome")).toBe(false);
});
it("replaces a fallback title when an asynchronous page toolbar mounts", async () => {
  const { container, rerender, getByTestId } = render(<Shell toolbar={false} />);
  const pane = container.querySelector<HTMLElement>('[data-workspace-pane="left"]')!;
  expect(pane.dataset.windowTitlebarFallbackActive).toBe("true");
  rerender(<Shell />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30);
  });
  expect(pane.dataset.windowTitlebarFallbackActive).toBeUndefined();
  expect(getByTestId("left").dataset.windowChrome).toBe("true");
});
it("clears insets and temporary drag regions when native merging is disabled", () => {
  const { getByTestId, rerender } = render(<Shell />);
  const toolbar = getByTestId("left");
  expect(toolbar.dataset.mistyWindowTitlebarRegion).toBe("true");
  rerender(<Shell enabled={false} />);
  expect(toolbar.dataset.mistyWindowTitlebarRegion).toBeUndefined();
  expect(toolbar.style.getPropertyValue("--window-chrome-left")).toBe("");
});
it("does not reserve controls for lower panes or unrelated horizontal spans", () => {
  expect(windowChromeInsets({ left: 200, right: 600, top: 0, bottom: 44 }, 1000, 84, 140)).toEqual({
    touchesTitlebar: true,
    left: 0,
    right: 0,
  });
  expect(windowChromeInsets({ left: 0, right: 1000, top: 38, bottom: 82 }, 1000, 84, 140)).toEqual({
    touchesTitlebar: false,
    left: 0,
    right: 0,
  });
});
