import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMobileStagePresentation } from "./MobileSurfaceContext";

class ResizeObserverMock {
  static callback: ResizeObserverCallback | null = null;
  constructor(callback: ResizeObserverCallback) {
    ResizeObserverMock.callback = callback;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function Probe(props: { onValue: (value: string) => void }) {
  const { presentation, stageRef } = useMobileStagePresentation();
  useEffect(() => props.onValue(presentation), [presentation, props]);
  return <section ref={stageRef} data-testid="stage" />;
}

describe("mobile surface presentation", () => {
  it("uses content-stage dimensions for compact and regular classes", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const onValue = vi.fn();
    render(<Probe onValue={onValue} />);

    act(() => {
      ResizeObserverMock.callback?.(
        [{ contentRect: { width: 719, height: 900 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(onValue).toHaveBeenLastCalledWith("mobile-compact");

    act(() => {
      ResizeObserverMock.callback?.(
        [{ contentRect: { width: 720, height: 600 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(onValue).toHaveBeenLastCalledWith("mobile-regular");

    act(() => {
      ResizeObserverMock.callback?.(
        [{ contentRect: { width: 1024, height: 599 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(onValue).toHaveBeenLastCalledWith("mobile-compact");
    vi.unstubAllGlobals();
  });
});
