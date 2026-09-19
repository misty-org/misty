import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installOverflowFade } from "./overflow-fade";

describe("app-wide overflow fades", () => {
  let stop: (() => void) | undefined;
  let resized: ResizeObserverCallback;
  const unobserve = vi.fn();
  const disconnect = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = callback;
        }
        observe = vi.fn();
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    const computedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computedStyle(element);
      // jsdom does not compile Tailwind utilities or registered properties.
      return {
        direction: style.direction,
        getPropertyValue: (property: string) =>
          property === "--misty-overflow-fade"
            ? element.matches('.truncate, .text-ellipsis, [class*="text-ellipsis"] > strong')
              ? "1"
              : "0"
            : style.getPropertyValue(property),
      } as CSSStyleDeclaration;
    });
  });

  afterEach(() => {
    stop?.();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tick = async () => {
    await Promise.resolve(); // Deliver mutations before the next animation frame.
    vi.advanceTimersByTime(20);
  };
  const label = (className = "truncate") => {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = "Google Drive";
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 80 },
      scrollWidth: { configurable: true, value: 140 },
    });
    document.body.append(element);
    return element;
  };

  it("fades overflowing labels and removes the fade when their container grows", async () => {
    const element = label();
    stop = installOverflowFade();
    await tick();
    expect(element.getAttribute("data-overflow-fade")).toBe("right");
    expect(element.textContent).toBe("Google Drive");
    Object.defineProperty(element, "clientWidth", { value: 180 });
    resized(
      [
        {
          target: element,
          contentRect: element.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      {} as ResizeObserver,
    );
    await tick();
    expect(element.getAttribute("data-overflow-fade")).toBe("none");
  });

  it("handles portaled labels, text changes, and right-to-left text", async () => {
    stop = installOverflowFade();
    const element = label("text-ellipsis");
    element.style.direction = "rtl";
    await tick();
    expect(element.getAttribute("data-overflow-fade")).toBe("left");
    Object.defineProperty(element, "scrollWidth", { value: 50 });
    element.firstChild!.textContent = "Short";
    await tick();
    expect(element.getAttribute("data-overflow-fade")).toBe("none");
    element.remove();
    await tick();
    expect(unobserve).toHaveBeenCalledWith(element);
    expect(element.hasAttribute("data-overflow-fade")).toBe(false);
  });

  it("discovers descendant utility variants and releases labels when classes change", async () => {
    const parent = document.createElement("div");
    parent.className = "[&>strong]:text-ellipsis";
    const element = document.createElement("strong");
    Object.defineProperties(element, {
      clientWidth: { value: 80 },
      scrollWidth: { value: 140 },
    });
    parent.append(element);
    document.body.append(parent);
    stop = installOverflowFade();
    await tick();
    expect(element.getAttribute("data-overflow-fade")).toBe("right");
    parent.className = "";
    await tick();
    expect(element.hasAttribute("data-overflow-fade")).toBe(false);
  });

  it("cleans up observers and pending work on unmount", async () => {
    const element = label();
    stop = installOverflowFade();
    await tick();
    stop();
    stop = undefined;
    await tick();
    expect(disconnect).toHaveBeenCalled();
    expect(element.hasAttribute("data-overflow-fade")).toBe(false);
  });
});
