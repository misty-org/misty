import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NavigatorResizeHandle } from "./NavigatorResizeHandle";

describe.each([false, true])("NavigatorResizeHandle workspaceEdge=%s", (workspaceEdge) => {
  let container: HTMLDivElement;
  let root: Root;
  const resizing = vi.fn();
  beforeEach(async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    resizing.mockClear();
    function Fixture() {
      const [width, setWidth] = useState(264);
      return (
        <NavigatorResizeHandle
          workspaceEdge={workspaceEdge}
          width={width}
          zoom={2}
          onChange={setWidth}
          onResizingChange={resizing}
        />
      );
    }
    await act(async () => root.render(<Fixture />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const pointer = async (target: EventTarget, type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    await act(async () => {
      target.dispatchEvent(event);
    });
  };
  it("resizes in logical pixels at zoom, clamps, and cleans up on release", async () => {
    const handle = container.querySelector('[role="separator"]')!;
    await pointer(handle, "pointerdown", 528);
    await pointer(window, "pointermove", 728);
    expect(handle.getAttribute("aria-valuenow")).toBe("364");
    await pointer(window, "pointermove", 1800);
    expect(handle.getAttribute("aria-valuenow")).toBe("480");
    await pointer(window, "pointerup", 1800);
    expect(resizing.mock.calls).toEqual([[true], [false]]);
    expect(document.documentElement.style.cursor).toBe("");
    await pointer(window, "pointermove", 200);
    expect(handle.getAttribute("aria-valuenow")).toBe("480");
  });
  it("cancels with Escape and supports keyboard resizing and double-click reset", async () => {
    const handle = container.querySelector('[role="separator"]')!;
    await pointer(handle, "pointerdown", 528);
    await pointer(window, "pointermove", 728);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(handle.getAttribute("aria-valuenow")).toBe("264");
    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(handle.getAttribute("aria-valuenow")).toBe("274");
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(handle.getAttribute("aria-valuenow")).toBe("264");
  });
  it("releases the resize session on unmount", async () => {
    await pointer(container.querySelector('[role="separator"]')!, "pointerdown", 528);
    await act(async () => root.render(null));
    expect(resizing).toHaveBeenLastCalledWith(false);
    expect(document.documentElement.style.userSelect).toBe("");
  });
});
