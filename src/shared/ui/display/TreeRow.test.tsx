import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pencil } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItem } from "../overlays/MenuItem";
import { TreeRow } from "./TreeRow";

afterEach(cleanup);

describe("TreeRow", () => {
  it("indents by depth and opens from its name", () => {
    const onOpen = vi.fn();
    render(<TreeRow label="App.java" depth={2} onOpen={onOpen} />);
    const open = screen.getByRole("button", { name: "App.java" });
    expect((open.parentElement as HTMLElement).style.paddingLeft).toBe("40px");
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("says whether a folder is open and turns its chevron", () => {
    const { rerender } = render(
      <TreeRow
        label="src"
        chevron
        expanded={false}
        openLabel="Expand folder src"
        onOpen={vi.fn()}
      />,
    );
    const open = screen.getByRole("button", { name: "Expand folder src" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.querySelector("svg")?.getAttribute("class")).not.toContain("rotate-90");
    rerender(<TreeRow label="src" chevron expanded onOpen={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "src" }).querySelector("svg")?.getAttribute("class"),
    ).toContain("rotate-90");
  });

  it("puts the name first, the detail after it, the state last, and one ⋯", () => {
    render(
      <ul>
        <TreeRow
          as="li"
          label="App.java"
          detail="src/main/"
          tone="modified"
          selected
          end={<span>M</span>}
          onOpen={vi.fn()}
          menu={<MenuItem icon={Pencil} label="Rename" />}
        />
      </ul>,
    );
    const row = document.querySelector("li")!;
    expect(row.getAttribute("data-selected")).toBe("true");
    expect(screen.getByText("App.java").getAttribute("data-tone")).toBe("modified");
    const order = [...row.querySelectorAll("*")].map((node) => node.textContent);
    expect(order.indexOf("App.java")).toBeLessThan(order.indexOf("src/main/"));
    expect(order.indexOf("src/main/")).toBeLessThan(order.indexOf("M"));
    expect(screen.getByRole("button", { name: "Actions for App.java" })).toBeTruthy();
  });

  it("leaves the ⋯ out without a menu", () => {
    render(<TreeRow label="a.ts" onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Actions for a.ts" })).toBeNull();
  });
});
