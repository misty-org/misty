import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDockingTransition } from "./useDockingTransition";

const suspend = vi.hoisted(() => vi.fn());
vi.mock("@/features/webviews/browserRuntime", () => ({ setBrowserWebviewsSuspended: suspend }));
let finish: () => void;
let animation: { finished: Promise<void>; cancel: ReturnType<typeof vi.fn> };
const animate = vi.fn();
function Shell({ edge }: { edge: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDockingTransition(ref, edge);
  return (
    <div ref={ref}>
      <div className="misty-workspace-tabs" data-edge={edge} />
      <input defaultValue="Unsent work" />
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  animation = {
    finished: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel: vi.fn(),
  };
  animate.mockReturnValue(animation);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      left: this.dataset.edge === "left" ? 0 : 100,
      top: 38,
      width: 200,
      height: 400,
    } as DOMRect;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("waits for actual motion completion and keeps open work mounted", async () => {
  const { rerender, getByRole } = render(<Shell edge="left" />);
  const editor = getByRole("textbox");
  rerender(<Shell edge="right" />);
  expect(getByRole("textbox")).toBe(editor);
  expect(animate).toHaveBeenCalledWith([{ translate: "-100px 0px" }, { translate: "0px 0px" }], {
    duration: 300,
    easing: "ease-in-out",
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(suspend).toHaveBeenLastCalledWith(true, "docking-layout");
  await act(async () => finish());
  expect(suspend).toHaveBeenLastCalledWith(false, "docking-layout");
});
it("respects reduced motion without a fixed suspension delay", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { rerender } = render(<Shell edge="left" />);
  rerender(<Shell edge="right" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(animate).not.toHaveBeenCalled();
  expect(suspend).toHaveBeenLastCalledWith(false, "docking-layout");
});
it("cancels old motion and prevents an old completion from revealing native pages during a new transition", async () => {
  const { rerender, unmount } = render(<Shell edge="left" />);
  rerender(<Shell edge="right" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  const finishOld = finish;
  animation = {
    finished: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel: vi.fn(),
  };
  animate.mockReturnValue(animation);
  rerender(<Shell edge="bottom" />);
  await act(async () => {
    finishOld();
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(suspend).toHaveBeenLastCalledWith(true, "docking-layout");
  unmount();
  expect(animation.cancel).toHaveBeenCalled();
  expect(suspend).toHaveBeenLastCalledWith(false, "docking-layout");
});
