import { afterEach, expect, it, vi } from "vitest";
import { reorderLayoutRect, settleReorderMotion, startReorderMotion } from "./pointerReorderMotion";

afterEach(() => {
  settleReorderMotion();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(axis: "x" | "y" = "x", reduced = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  let frame: FrameRequestCallback;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  const list = document.createElement("div");
  list.dataset.reorderAnimated = "true";
  list.dataset.reorderList = "tabs";
  list.style.columnGap = "6px";
  list.style.rowGap = "6px";
  list.getBoundingClientRect = () =>
    axis === "x" ? new DOMRect(0, 0, 312, 32) : new DOMRect(0, 0, 120, 312);
  const items = [80, 120, 100].map((width, index) => {
    const item = document.createElement("div");
    item.dataset.reorderItem = String(index);
    item.dataset.size = String(width);
    list.append(item);
    item.getBoundingClientRect = () => {
      let offset = 0;
      for (const sibling of list.children) {
        if (sibling === item) break;
        offset += Number((sibling as HTMLElement).dataset.size) + 6;
      }
      const translation = Number(
        item.style.transform.match(/translate[XY]\((-?[\d.]+)px\)/)?.[1] || 0,
      );
      return axis === "x"
        ? new DOMRect(offset + translation - list.scrollLeft, 0, width, 32)
        : new DOMRect(0, offset + translation - list.scrollTop, 120, width);
    };
    item.animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null }) as unknown as Animation);
    return item;
  });
  document.body.append(list);
  return { list, items, flush: () => frame!(0) };
}
it.each(["x", "y"] as const)(
  "slides unequal tabs on %s without moving their hit targets",
  (axis) => {
    const { list, items, flush } = fixture(axis);
    const motion = startReorderMotion(items[0], ["0"], axis)!;
    motion.update("2", true);
    expect(items[1].style.transform).toBe(`translate${axis.toUpperCase()}(-86px)`);
    expect(items[2].style.transform).toBe(`translate${axis.toUpperCase()}(-86px)`);
    expect([...list.children]).toEqual(items);
    expect(reorderLayoutRect(items[1])[axis === "x" ? "left" : "top"]).toBe(86);
    if (axis === "x") list.scrollLeft = 20;
    else list.scrollTop = 20;
    expect(reorderLayoutRect(items[1])[axis === "x" ? "left" : "top"]).toBe(66);
    motion.finish();
    flush();
    expect(items.every((item) => !item.style.transform && !item.dataset.reorderLifted)).toBe(true);
  },
);
it("settles after the committed order and does not move the destination backward", () => {
  const { list, items, flush } = fixture();
  const motion = startReorderMotion(items[0], ["0"], "x")!;
  motion.update("2", true);
  motion.finish();
  list.append(items[0]);
  flush();
  expect(reorderLayoutRect(items[0]).left).toBe(232);
  expect(items[1].style.transform).toBe("");
  expect(items[2].style.transform).toBe("");
});
it("moves a group as one block and restores it before another gesture", () => {
  const { items } = fixture();
  const motion = startReorderMotion(items[0], ["0", "1"], "x")!;
  motion.update("2", true);
  expect(items[2].style.transform).toBe("translateX(-212px)");
  expect(items[0].dataset.reorderLifted).toBe("true");
  expect(items[1].dataset.reorderLifted).toBe("true");
  settleReorderMotion();
  expect(items.every((item) => !item.style.transform && !item.dataset.reorderLifted)).toBe(true);
});
it("keeps the insertion preview but skips spatial animations with reduced motion", () => {
  const { items, flush } = fixture("x", true);
  const motion = startReorderMotion(items[0], ["0"], "x")!;
  motion.update("2", true);
  expect(items[1].style.transform).toBe("translateX(-86px)");
  motion.finish();
  flush();
  expect(items.every((item) => vi.mocked(item.animate).mock.calls.length === 0)).toBe(true);
});

it("slides the covered neighbor right when dragging left, then restores it on reversal", () => {
  const { items } = fixture();
  const motion = startReorderMotion(items[2], ["2"], "x")!;
  motion.update("1", false);
  expect(items[1].style.transform).toBe("translateX(106px)");
  expect(items[0].style.transform).toBe("translateX(0px)");
  motion.update("2", false);
  expect(items[1].style.transform).toBe("translateX(0px)");
});
it("tracks the lifted tab's leading edge regardless of where it was grabbed and keeps it on its row", () => {
  const { items } = fixture();
  const motion = startReorderMotion(items[0], ["0"], "x")!;
  const leftGrip = motion.placement({ x: 125, y: 48 }, { x: 5, y: 16 });
  const rightGrip = motion.placement({ x: 195, y: -10 }, { x: 75, y: 16 });
  // Moving right, the trailing edge leads: a neighbor swaps once half covered.
  expect(leftGrip).toEqual({ left: 120, top: 0, hitX: 199.5, hitY: 16 });
  expect(rightGrip).toEqual(leftGrip);
  expect(motion.placement({ x: 125, y: 100 }, { x: 5, y: 16 })).toBeUndefined();
});
it("allows a wide tab to reach the first slot and a narrow tab to reach the last slot", () => {
  const { items } = fixture();
  const left = startReorderMotion(items[2], ["2"], "x")!;
  expect(left.placement({ x: 0, y: 16 }, { x: 50, y: 16 })?.hitX).toBe(0);
  settleReorderMotion();
  const right = startReorderMotion(items[0], ["0"], "x")!;
  expect(right.placement({ x: 312, y: 16 }, { x: 40, y: 16 })?.hitX).toBe(312);
});
