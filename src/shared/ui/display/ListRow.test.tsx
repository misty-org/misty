import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItem } from "../overlays/MenuItem";
import { ListRow, formatRowTime } from "./ListRow";
import { FileText, Pencil } from "lucide-react";

afterEach(cleanup);

describe("ListRow", () => {
  it("opens from its label and marks the selected row", () => {
    const onOpen = vi.fn();
    render(<ListRow label="Q3 planning" selected onOpen={onOpen} />);
    const open = screen.getByRole("button", { name: "Q3 planning" });
    expect(open.getAttribute("aria-current")).toBe("true");
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("shows its state at the right end", () => {
    const { rerender } = render(<ListRow label="Chat" state={{ kind: "waiting" }} />);
    expect(screen.getByRole("img", { name: "Waiting for you" })).toBeTruthy();
    rerender(<ListRow label="Chat" state={{ kind: "unread" }} />);
    expect(screen.getByRole("img", { name: "Unread" })).toBeTruthy();
    rerender(<ListRow label="Chat" state={{ kind: "working" }} />);
    expect(screen.getByRole("img", { name: "Working" })).toBeTruthy();
    rerender(<ListRow label="Chat" state={{ kind: "done" }} />);
    expect(screen.getByRole("img", { name: "Done" })).toBeTruthy();
    rerender(<ListRow label="Chat" state={{ kind: "failed", label: "Failed: key refused" }} />);
    expect(screen.getByRole("img", { name: "Failed: key refused" })).toBeTruthy();
    const at = new Date(Date.now() - 5 * 60_000);
    rerender(<ListRow label="Chat" state={{ kind: "time", at }} />);
    expect(screen.getByText("5m").getAttribute("dateTime")).toBe(at.toISOString());
  });

  it("shows a checkmark in place of its state while checked", () => {
    render(<ListRow label="Chat" checked state={{ kind: "unread" }} />);
    expect(screen.getByRole("img", { name: "Selected" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Unread" })).toBeNull();
    expect(screen.getByRole("button", { name: "Chat" }).getAttribute("aria-current")).toBeNull();
  });

  it("puts its actions behind a ⋯ named for the row", () => {
    render(
      <ListRow
        label="Chat"
        state={{ kind: "unread" }}
        menuLabel="Chat actions"
        menu={<MenuItem icon={Pencil} label="Rename" />}
      />,
    );
    expect(screen.getByRole("button", { name: "Chat actions" })).toBeTruthy();
  });

  it("starts with what the item is, in its tone", () => {
    const { container } = render(
      <ListRow label="Notes" leading={FileText} leadingTone="blue" onOpen={() => {}} />,
    );
    const leading = container.querySelector("[data-slot=list-row-leading]")!;
    expect(leading.querySelector("svg")).toBeTruthy();
    expect(leading.className).toContain("text-tone-blue");
    expect(screen.getByRole("button", { name: "Notes" })).toBeTruthy();
  });

  it("grows to two lines with a description that describes the row", () => {
    const { container } = render(
      <ListRow label="frontend-design" description="Builds distinctive interfaces" />,
    );
    const open = screen.getByRole("button", { name: "frontend-design" });
    const line = container.querySelector("[data-slot=list-row-description]")!;
    expect(line.textContent).toBe("Builds distinctive interfaces");
    expect(open.getAttribute("aria-describedby")).toBe(line.id);
    expect(container.querySelector("[data-slot=list-row]")!.className).toContain("min-h-12");
  });

  it("keeps trailing controls and a badge in view without opening the row", () => {
    const onOpen = vi.fn();
    const install = vi.fn();
    render(
      <ListRow
        label="Skill"
        badge={<span>Plugin</span>}
        onOpen={onOpen}
        trailing={
          <button type="button" onClick={install}>
            Install
          </button>
        }
      />,
    );
    expect(screen.getByText("Plugin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(install).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders as a link with href", () => {
    render(<ListRow label="Notes" href="#/notes" />);
    expect(screen.getByRole("link", { name: "Notes" }).getAttribute("href")).toBe("#/notes");
  });
});

describe("formatRowTime", () => {
  const now = new Date(2026, 10, 12, 12, 0).getTime();
  it("counts up in minutes, hours and days, then gives the date", () => {
    expect(formatRowTime(now - 20_000, now)).toBe("now");
    expect(formatRowTime(now - 59 * 60_000, now)).toBe("59m");
    expect(formatRowTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatRowTime(now - 2 * 86_400_000, now)).toBe("2d");
    expect(formatRowTime(new Date(2026, 9, 4), now)).not.toContain("2026");
    expect(formatRowTime(new Date(2025, 9, 4), now)).toContain("2025");
    expect(formatRowTime("not a date", now)).toBe("");
  });
});
