import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabStrip, type TabStripTab } from "./TabStrip";

afterEach(cleanup);

const tabs: TabStripTab[] = [
  { id: "files", label: "Files" },
  { id: "a", label: "a.ts", closeLabel: "Close a.ts" },
  { id: "b", label: "b.ts", closeLabel: "Close b.ts" },
];

describe("TabStrip", () => {
  it("marks the open tab and selects another on a click", () => {
    const onSelect = vi.fn();
    render(<TabStrip label="Open files" tabs={tabs} active="a" onSelect={onSelect} />);
    expect(screen.getByRole("tablist", { name: "Open files" })).toBeTruthy();
    const open = screen.getByRole("tab", { name: "a.ts" });
    expect(open.getAttribute("aria-selected")).toBe("true");
    expect(open.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "b.ts" }).tabIndex).toBe(-1);
    fireEvent.click(screen.getByRole("tab", { name: "b.ts" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("moves with the arrows and Home and End, wrapping at the ends", () => {
    const onSelect = vi.fn();
    render(<TabStrip label="Open files" tabs={tabs} active="b" onSelect={onSelect} />);
    const open = screen.getByRole("tab", { name: "b.ts" });
    act(() => {
      fireEvent.keyDown(open, { key: "ArrowRight" });
      fireEvent.keyDown(open, { key: "ArrowLeft" });
      fireEvent.keyDown(open, { key: "Home" });
      fireEvent.keyDown(open, { key: "End" });
      fireEvent.keyDown(open, { key: "ArrowRight", metaKey: true });
    });
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(["files", "a", "files", "b"]);
  });

  it("closes only the tabs that have a closer, from it or a middle click", () => {
    const onClose = vi.fn();
    render(
      <TabStrip label="Open files" tabs={tabs} active="a" onSelect={vi.fn()} onClose={onClose} />,
    );
    expect(screen.queryByRole("button", { name: "Close Files" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    expect(onClose).toHaveBeenCalledWith("a");
    const files = screen.getByRole("tab", { name: "Files" }).parentElement!;
    fireEvent(files, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const b = screen.getByRole("tab", { name: "b.ts" }).parentElement!;
    fireEvent(b, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenLastCalledWith("b");
  });

  it("drags only when it can reorder", () => {
    const onReorder = vi.fn();
    const { rerender } = render(
      <TabStrip label="Open files" tabs={tabs} active="a" onSelect={vi.fn()} />,
    );
    const row = () => screen.getByRole("tab", { name: "b.ts" }).parentElement!;
    expect(row().hasAttribute("data-reorder-handle")).toBe(false);
    rerender(
      <TabStrip
        label="Open files"
        tabs={tabs}
        active="a"
        onSelect={vi.fn()}
        onReorder={onReorder}
      />,
    );
    expect(row().hasAttribute("data-reorder-handle")).toBe(true);
    fireEvent.keyDown(screen.getByRole("tab", { name: "b.ts" }), {
      key: "ArrowLeft",
      altKey: true,
      shiftKey: true,
    });
    expect(onReorder).toHaveBeenCalledWith("b", 1);
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
});
