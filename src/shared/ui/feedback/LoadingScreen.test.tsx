import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "@/shared/ui";

/** Misty reaching the end of a pass along her track, or the bob inside it ending one of its own. */
function pass(container: HTMLElement, animationName = "misty-fly-x") {
  const crossing = container.querySelector(".misty-fly-x")!;
  // jsdom has no AnimationEvent, so React listens under the prefixed name there.
  for (const type of ["animationiteration", "webkitAnimationIteration"]) {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { animationName });
    act(() => void crossing.dispatchEvent(event));
  }
}

describe("LoadingScreen", () => {
  let container: HTMLDivElement;
  let root: Root;
  const screen = () => container.firstElementChild as HTMLElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("lets Misty finish her pass before the splash fades", () => {
    act(() => root.render(<LoadingScreen fullScreen />));
    act(() => root.render(<LoadingScreen fullScreen leaving />));
    expect(screen().className).not.toContain("misty-loading-screen-leaving");
    // The bob ending a pass of its own isn't Misty arriving.
    pass(container, "misty-fly-y");
    expect(screen().className).not.toContain("misty-loading-screen-leaving");
    pass(container);
    expect(screen().className).toContain("misty-loading-screen-leaving");
  });

  it("never waits longer than one pass", () => {
    act(() => root.render(<LoadingScreen fullScreen leaving />));
    act(() => void vi.advanceTimersByTime(3_500));
    expect(screen().className).toContain("misty-loading-screen-leaving");
  });

  it("doesn't fade while it is still loading", () => {
    act(() => root.render(<LoadingScreen fullScreen />));
    pass(container);
    expect(screen().className).not.toContain("misty-loading-screen-leaving");
  });
});
