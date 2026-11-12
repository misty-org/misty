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
    { label: id, icon: Search, current: id === "tutor", open: () => void opened.push(id) },
  ]),
) as Record<SidebarPlaceId, SidebarPlace>;

beforeEach(() => {
  stored.value = null;
  opened.length = 0;
  useSidebarPins.setState({
    order: [...sidebarPlaceIds],
    pinned: ["search", "space", "integrations"],
  });
});

describe("sidebar pins", () => {
  it("drops unknown rows and adds new ones as they are by default", async () => {
    stored.value = { order: ["tutor", "gone", "space"], pinned: ["tutor", "gone"] };
    await useSidebarPins.getState().load();
    const { order, pinned } = useSidebarPins.getState();
    expect(order.slice(0, 2)).toEqual(["tutor", "space"]);
    expect(order).toHaveLength(sidebarPlaceIds.length);
    expect(pinned).toEqual(["tutor", "search", "integrations"]);
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
    expect(items).toEqual(["studio", "tutor", "Reorder pins"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "studio" }));
    expect(opened).toEqual(["studio"]);
  });

  it("pins and reorders from the list right-click opens", async () => {
    render(<SidebarMore places={places} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reorder pins" }));
    const list = await screen.findByRole("list", { name: "Pins" });
    fireEvent.click(within(list).getByRole("checkbox", { name: "studio" }));
    expect(useSidebarPins.getState().pinned).toContain("studio");
    fireEvent.keyDown(within(list).getByRole("button", { name: "Move studio" }), {
      key: "ArrowUp",
    });
    expect(useSidebarPins.getState().order.indexOf("studio")).toBe(2);
    expect((stored.value as { order: string[] }).order[2]).toBe("studio");
  });
});
