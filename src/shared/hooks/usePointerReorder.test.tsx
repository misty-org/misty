import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { reorderIds, usePointerReorder } from "./usePointerReorder";
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
function List({
  scope = "test",
  drop = vi.fn(),
  click = vi.fn(),
}: {
  scope?: string;
  drop?: (id: string, target: string, after: boolean) => void;
  click?: () => void;
}) {
  const [ids, setIds] = useState(["a", "b", "c"]);
  const drag = usePointerReorder({
    scope,
    axis: "y",
    getDrag: (id) => ({ id, label: id }),
    onDrop: (drag, target, after) => {
      drop(drag.id, target, after);
      setIds((ids) => reorderIds(ids, [drag.id], target, after));
    },
    onKeyboardMove: (id, direction) => {
      const target = ids[ids.indexOf(id) + direction];
      if (target) setIds(reorderIds(ids, [id], target, direction === 1));
    },
  });
  return (
    <div {...drag} data-testid="list">
      {ids.map((id) => (
        <div key={id} data-reorder-item={id}>
          <button data-reorder-handle="true" onClick={click}>
            {id}
          </button>
          <button aria-label={`Close ${id}`}>×</button>
        </div>
      ))}
    </div>
  );
}
function bounds() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-reorder-list")) return new DOMRect(0, 0, 200, 120);
    const item = this.closest<HTMLElement>("[data-reorder-item]");
    const index = item ? [...item.parentElement!.children].indexOf(item) : 0;
    return new DOMRect(0, index * 40, 200, 40);
  });
}
function pointer(
  element: EventTarget,
  type: string,
  x: number,
  y: number,
  extras: Record<string, unknown> = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    ...Object.fromEntries(Object.entries(extras).map(([key, value]) => [key, { value }])),
  });
  act(() => element.dispatchEvent(event));
}
it("reorders only on release and suppresses the post-drag click", () => {
  bounds();
  const drop = vi.fn(),
    click = vi.fn();
  const ui = render(<List drop={drop} click={click} />);
  pointer(ui.getByText("a"), "pointerdown", 10, 10);
  pointer(window, "pointermove", 10, 110);
  expect(drop).not.toHaveBeenCalled();
  expect(document.querySelector(".pointer-reorder-indicator")).toBeTruthy();
  pointer(window, "pointerup", 10, 110);
  fireEvent.click(ui.getByText("a"), { detail: 1 });
  expect(click).not.toHaveBeenCalled();
  expect(drop).toHaveBeenCalledExactlyOnceWith("a", "c", true);
  expect(
    [...ui.getByTestId("list").children].map((item) => item.getAttribute("data-reorder-item")),
  ).toEqual(["b", "c", "a"]);
  expect(document.querySelector(".pointer-reorder-shield")).toBeNull();
});
it.each(["escape", "blur", "pointercancel", "lostcapture", "unmount", "outside"])(
  "cancels on %s without mutating the order",
  (reason) => {
    bounds();
    const drop = vi.fn();
    const ui = render(<List drop={drop} />);
    const a = ui.getByText("a");
    pointer(a, "pointerdown", 10, 10);
    pointer(window, "pointermove", 10, 110);
    if (reason === "escape") fireEvent.keyDown(window, { key: "Escape" });
    if (reason === "blur") fireEvent.blur(window);
    if (reason === "pointercancel") pointer(window, "pointercancel", 10, 110);
    if (reason === "lostcapture") pointer(a, "lostpointercapture", 10, 110);
    if (reason === "unmount") ui.unmount();
    if (reason === "outside") pointer(window, "pointerup", 500, 500);
    expect(drop).not.toHaveBeenCalled();
    expect(document.querySelector(".pointer-reorder-shield")).toBeNull();
    expect(document.documentElement.dataset.pointerDragging).toBeUndefined();
  },
);
it("keeps ordinary clicks and controls intact, and supports keyboard reordering", () => {
  bounds();
  const drop = vi.fn(),
    click = vi.fn();
  const ui = render(<List drop={drop} click={click} />);
  pointer(ui.getByText("a"), "pointerdown", 10, 10);
  pointer(window, "pointermove", 12, 12);
  pointer(window, "pointerup", 12, 12);
  fireEvent.click(ui.getByText("a"));
  expect(click).toHaveBeenCalledOnce();
  expect(drop).not.toHaveBeenCalled();
  pointer(ui.getByRole("button", { name: "Close a" }), "pointerdown", 10, 10);
  pointer(window, "pointermove", 10, 110);
  pointer(window, "pointerup", 10, 110);
  expect(drop).not.toHaveBeenCalled();
  fireEvent.keyDown(ui.getByText("a"), { key: "ArrowDown", altKey: true, shiftKey: true });
  expect(
    [...ui.getByTestId("list").children].map((item) => item.getAttribute("data-reorder-item")),
  ).toEqual(["b", "a", "c"]);
});
it("ignores a second pointer and cancels when the held button is lost", () => {
  bounds();
  const drop = vi.fn();
  const ui = render(<List drop={drop} />);
  pointer(ui.getByText("a"), "pointerdown", 10, 10);
  pointer(window, "pointermove", 10, 110, { pointerId: 2 });
  expect(document.querySelector(".pointer-reorder-shield")).toBeNull();
  pointer(window, "pointermove", 10, 110);
  pointer(window, "pointermove", 10, 110, { buttons: 0 });
  expect(drop).not.toHaveBeenCalled();
  expect(document.querySelector(".pointer-reorder-shield")).toBeNull();
});
it("moves complete groups without losing or duplicating members", () => {
  expect(reorderIds(["a1", "b1", "a2", "c"], ["a1", "a2"], "c", true)).toEqual([
    "b1",
    "c",
    "a1",
    "a2",
  ]);
});

it("lifts the painted row with its icon, dimensions and styling, without its expanded children", () => {
  bounds();
  function PreviewList() {
    const reorder = usePointerReorder({
      scope: "preview",
      axis: "y",
      getDrag: (id) => ({ id, label: id }),
      onDrop: vi.fn(),
      onKeyboardMove: vi.fn(),
    });
    return (
      <div {...reorder}>
        <div data-reorder-item="app">
          <div
            data-reorder-preview="true"
            style={{ backgroundColor: "rgb(40, 40, 40)", borderRadius: 6 }}
          >
            <button data-reorder-handle="true" id="app-trigger" style={{ fontSize: 13 }}>
              <svg aria-hidden="true">
                <defs>
                  <clipPath id="app-clip">
                    <rect width="16" height="16" />
                  </clipPath>
                </defs>
                <path clipPath="url(#app-clip)" d="M0 0h16v16H0z" />
              </svg>
              Gmail
            </button>
            <span>2</span>
          </div>
          <div>Expanded child</div>
        </div>
      </div>
    );
  }
  const ui = render(<PreviewList />);
  const handle = ui.getByRole("button", { name: "Gmail" });
  pointer(handle, "pointerdown", 30, 12);
  pointer(window, "pointermove", 80, 72);
  const ghost = document.querySelector<HTMLElement>(".pointer-reorder-preview")!;
  expect(ghost.getAttribute("aria-hidden")).toBe("true");
  expect(ghost.inert).toBe(true);
  expect(ghost.textContent).toBe("Gmail2");
  expect(ghost.querySelector("svg")).not.toBeNull();
  expect(ghost.querySelector("[data-reorder-handle]")).toBeNull();
  expect(ghost.querySelector("#app-trigger")).toBeNull();
  const clip = ghost.querySelector("clipPath")!;
  expect(ghost.querySelector("path")?.getAttribute("clip-path")).toBe(`url(#${clip.id})`);
  expect(ghost.style.width).toBe("200px");
  expect(ghost.style.height).toBe("40px");
  expect(ghost.style.left).toBe("50px");
  expect(ghost.style.top).toBe("60px");
  expect((ghost.firstElementChild as HTMLElement).style.backgroundColor).toBe("rgb(40, 40, 40)");
  expect((ghost.querySelector("button") as HTMLElement).style.fontSize).toBe("13px");
  expect(handle.parentElement?.dataset.reorderDragging).toBe("true");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(handle.parentElement?.dataset.reorderDragging).toBeUndefined();
  expect(document.querySelector(".pointer-reorder-preview")).toBeNull();
});

it("places whole apps by their header position even when the target has tall subsections", () => {
  const drop = vi.fn();
  function Sections() {
    const reorder = usePointerReorder({
      scope: "sections",
      axis: "y",
      hitArea: "header",
      getDrag: (id) => ({ id, label: id }),
      onDrop: drop,
      onKeyboardMove: vi.fn(),
    });
    return (
      <div {...reorder}>
        <div data-reorder-item="social">
          <button data-reorder-handle data-reorder-header>
            Social
          </button>
          <div>Many children</div>
        </div>
        <div data-reorder-item="files">
          <button data-reorder-handle data-reorder-header>
            Files
          </button>
        </div>
      </div>
    );
  }
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-reorder-list")) return new DOMRect(0, 0, 240, 640);
    const social = this.closest('[data-reorder-item="social"]');
    return new DOMRect(
      0,
      social ? 0 : 600,
      240,
      this.hasAttribute("data-reorder-header") ? 32 : social ? 600 : 32,
    );
  });
  const ui = render(<Sections />);
  pointer(ui.getByRole("button", { name: "Files" }), "pointerdown", 200, 615);
  pointer(window, "pointermove", 200, 28);
  const marker = document.querySelector<HTMLElement>(".pointer-reorder-indicator")!;
  expect(marker.style.top).toBe("600px");
  pointer(window, "pointerup", 200, 28);
  expect(drop).toHaveBeenCalledWith(expect.objectContaining({ id: "files" }), "social", true);
});
