import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Search } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
afterEach(cleanup);

const stored = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/features/agents", () => ({
  readDeviceState: vi.fn(async () => stored.value),
  updateDeviceState: vi.fn(
    async (_scope: string, _seed: unknown, change: (s: unknown) => unknown) => {
      stored.value = change(stored.value);
      return stored.value;
    },
  ),
}));

import { SidebarMore, type SidebarPlace } from "./SidebarPins";
import { sidebarPlaceIds, useSidebarPins, type SidebarPlaceId } from "./sidebarPinsStore";

const opened: string[] = [];
const places = Object.fromEntries(
  sidebarPlaceIds.map((id): [SidebarPlaceId, SidebarPlace] => [
    id,
    { label: id, icon: Search, current: id === "code", open: () => void opened.push(id) },
  ]),
) as Record<SidebarPlaceId, SidebarPlace>;

beforeEach(() => {
  stored.value = null;
  opened.length = 0;
  useSidebarPins.setState({
    order: [...sidebarPlaceIds],
    pinned: ["search", "space"],
  });
});

describe("sidebar pins", () => {
  it("drops unknown rows, renames old ones and adds new ones as they are by default", async () => {
    // Tutor became the Space's Lab, which has a row of its own: both become the Lab's row, kept
    // once. Agents moved into Settings and the Studio is gone, so their rows go. The
    // Space's pages that were never stored join after the row before them, unpinned.
    stored.value = {
      order: ["studio", "agents", "tutor", "gone", "lab"],
      pinned: ["lab", "agents", "gone"],
    };
    await useSidebarPins.getState().load();
    const { order, pinned } = useSidebarPins.getState();
    expect(order).toEqual([
      "lab",
      "search",
      "space",
      "code",
      "chat",
      "docs",
      "slides",
      "data",
      "whiteboards",
      "planner",
      "calendar",
      "media",
    ]);
    expect(order).toHaveLength(sidebarPlaceIds.length);
    expect(pinned).toEqual(["lab", "search", "space", "code"]);
  });

  it("puts Whiteboards beside a stored Docs row, pinned when Docs is", async () => {
    stored.value = {
      order: ["docs", "search", "space", "code", "chat", "lab", "planner", "calendar", "media"],
      pinned: ["docs", "search"],
    };
    await useSidebarPins.getState().load();
    const { order, pinned } = useSidebarPins.getState();
    expect(order.slice(0, 5)).toEqual(["docs", "slides", "data", "whiteboards", "search"]);
    expect(pinned).toEqual(["docs", "whiteboards", "search"]);
  });

  it("lists the rows that are not pinned under More and marks the open one", async () => {
    render(<SidebarMore places={places} />);
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-current")).toBe("page");
    more.focus();
    fireEvent.keyDown(more, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      ...sidebarPlaceIds.filter((id) => id !== "search" && id !== "space"),
      "Reorder pins",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "code" }));
    expect(opened).toEqual(["code"]);
  });

  it("pins and reorders from the list right-click opens", async () => {
    render(<SidebarMore places={places} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reorder pins" }));
    const list = await screen.findByRole("list", { name: "Pins" });
    fireEvent.click(within(list).getByRole("checkbox", { name: "code" }));
    expect(useSidebarPins.getState().pinned).toContain("code");
    fireEvent.keyDown(within(list).getByRole("button", { name: "Move code" }), {
      key: "ArrowUp",
    });
    expect(useSidebarPins.getState().order.indexOf("code")).toBe(1);
    expect((stored.value as { order: string[] }).order[1]).toBe("code");
  });
});
