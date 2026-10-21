import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserSlideExtra, endBrowserSlide } from "@/features/webviews/browserSlide";
import { SpaceBar } from "./SpaceBar";

const runtime = vi.hoisted(() => ({
  browserRuntimeResumeEvent: "misty:browser-runtime-resume",
  setBrowserPointerTrackingEnabled: vi.fn(),
}));
const settings = vi.hoisted(() => ({ autoHide: true }));
vi.mock("@/features/webviews/browserRuntime", () => runtime);
vi.mock("@/features/spaces", () => ({ SpaceRow: () => <button type="button">Space</button> }));
vi.mock("./useSpaceBarAutoHide", () => ({
  useSpaceBarAutoHide: () => settings.autoHide,
  useSpaceBarAlignment: () => "left",
}));

/** The row spans the content column from the window's top; open it is 42px tall. */
function rowRect(this: HTMLElement): DOMRect {
  const state = this.getAttribute("data-space-bar");
  const bottom = state === "open" ? 42 : 0;
  return state
    ? ({ left: 0, right: 800, top: 0, bottom, width: 800, height: bottom } as DOMRect)
    : ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect);
}

beforeEach(() => {
  vi.useFakeTimers();
  settings.autoHide = true;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(rowRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  runtime.setBrowserPointerTrackingEnabled.mockClear();
});

function mount() {
  const view = render(<SpaceBar gridColumn={2} />);
  const row = view.container.querySelector<HTMLElement>("[data-space-bar]")!;
  return { ...view, row };
}
function pointerAt(x: number, y: number) {
  fireEvent.pointerMove(window, { clientX: x, clientY: y });
}
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

it("comes out once the pointer rests on the top edge and stays while it rests there", () => {
  const { row } = mount();
  pointerAt(300, 2);
  expect(row.dataset.spaceBar).toBe("hidden");
  advance(100);
  expect(row.dataset.spaceBar).toBe("open");
  // The sidebar's drag band lies over the top of the row; resting there is still the bar.
  pointerAt(310, 2);
  advance(2000);
  expect(row.dataset.spaceBar).toBe("open");
});

it("stays tucked away when the pointer only passes over the edge", () => {
  const { row } = mount();
  pointerAt(300, 2);
  fireEvent.pointerOut(document.body, { relatedTarget: null });
  advance(500);
  expect(row.dataset.spaceBar).toBe("hidden");
  pointerAt(300, 2);
  pointerAt(300, 20);
  advance(500);
  expect(row.dataset.spaceBar).toBe("hidden");
});

it("tucks away after the pointer leaves for the page, a native page or another window", () => {
  const { row } = mount();
  const out = [
    () => pointerAt(300, 120),
    () =>
      window.dispatchEvent(
        new CustomEvent("misty:browser-pointer", { detail: { x: 300, y: 200 } }),
      ),
    () => fireEvent.pointerOut(document.body, { relatedTarget: null }),
  ];
  for (const leave of out) {
    pointerAt(300, 2);
    advance(100);
    expect(row.dataset.spaceBar).toBe("open");
    pointerAt(300, 30);
    leave();
    advance(400);
    expect(row.dataset.spaceBar).toBe("open");
    advance(200);
    expect(row.dataset.spaceBar).toBe("hidden");
  }
});

it("keeps coming back to the bar from going away", () => {
  const { row } = mount();
  pointerAt(300, 2);
  advance(100);
  pointerAt(300, 120);
  advance(300);
  pointerAt(300, 30);
  advance(2000);
  expect(row.dataset.spaceBar).toBe("open");
});

it("slides the bar at a steady pace in whole pixels, holding the page its full size", () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (callback) => window.setTimeout(() => callback(performance.now()), 16) as unknown as number,
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => window.clearTimeout(id));
  const resumed = vi.fn();
  window.addEventListener("misty:browser-runtime-resume", resumed);
  const { row } = mount();
  expect(browserSlideExtra()).toBe(0);
  pointerAt(300, 2);
  advance(100);
  // Sliding: the page is held at its tucked-away size, and the row moves in whole pixels.
  expect(browserSlideExtra()).toBe(42);
  expect(resumed).toHaveBeenCalledTimes(1);
  const heights: number[] = [];
  for (let frame = 0; frame < 12; frame += 1) {
    advance(16);
    heights.push(Number.parseFloat(row.style.height));
  }
  const slid = heights.filter((height) => Number.isFinite(height));
  expect(slid.length).toBeGreaterThan(2);
  expect(slid.every((height) => Number.isInteger(height))).toBe(true);
  // Steady: no step is more than twice another.
  const steps = slid.slice(1).map((height, index) => height - slid[index]!).filter((step) => step);
  expect(Math.max(...steps)).toBeLessThanOrEqual(Math.min(...steps) * 2);
  advance(300);
  expect(browserSlideExtra()).toBe(0);
  expect(row.style.height).toBe("calc(var(--pane-frame, 6px) + 36px)");
  expect(resumed).toHaveBeenCalledTimes(2);
  window.removeEventListener("misty:browser-runtime-resume", resumed);
});

it("grows the page before the bar leaves, and gives it back if the bar stays", () => {
  HTMLElement.prototype.getAnimations ??= () => [];
  mount();
  pointerAt(300, 2);
  advance(100);
  expect(browserSlideExtra()).toBe(42);
  endBrowserSlide();
  // The pointer leaves: the page is grown while the bar waits, ahead of the slide away.
  pointerAt(300, 120);
  expect(browserSlideExtra()).toBe(42);
  // It comes back before the wait is over: the page has its true size again.
  pointerAt(300, 10);
  expect(browserSlideExtra()).toBe(0);
});

it("fades the handle instead of mounting it over the sliding bar", () => {
  const { row, container } = mount();
  const handle = container.querySelector("[data-space-bar-handle]")!;
  expect(handle.className).toContain("opacity-100");
  pointerAt(300, 2);
  advance(100);
  expect(row.dataset.spaceBar).toBe("open");
  expect(container.querySelector("[data-space-bar-handle]")).toBe(handle);
  expect(handle.className).toContain("opacity-0");
});

it("pinned, takes its height and follows no pointer", () => {
  settings.autoHide = false;
  const { row, container } = mount();
  expect(row.dataset.spaceBar).toBe("open");
  expect(container.querySelector("[data-space-bar-handle]")).toBeNull();
  expect(runtime.setBrowserPointerTrackingEnabled).not.toHaveBeenCalled();
});
