import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavIsland, NavIslandItem } from "./nav-island";

describe("NavIsland CVA component", () => {
  it("renders nav island container and items with default styles", () => {
    render(
      <NavIsland aria-label="Sections">
        <NavIslandItem active>All</NavIslandItem>
        <NavIslandItem>Unread</NavIslandItem>
      </NavIsland>,
    );

    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav).toBeDefined();
    expect(nav.getAttribute("data-slot")).toBe("nav-island");
    expect(nav.className).toContain("rounded-lg");
    expect(nav.className).toContain("p-0.5");
    expect(nav.className).toContain("bg-charcoal-card");

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);

    const activeItem = buttons[0];
    expect(activeItem.getAttribute("aria-current")).toBe("page");
    expect(activeItem.getAttribute("data-active")).toBe("true");
    expect(activeItem.className).toContain("h-6");
    expect(activeItem.className).toContain("px-2");
    expect(activeItem.className).toContain("text-xs");
    expect(activeItem.className).toContain("!bg-charcoal-hover");

    const inactiveItem = buttons[1];
    expect(inactiveItem.getAttribute("aria-current")).toBeNull();
    expect(inactiveItem.className).toContain("text-cream-muted");
  });

  it("supports aria-current attribute for active state", () => {
    render(
      <NavIsland aria-label="Tabs">
        <NavIslandItem aria-current="page">Tab 1</NavIslandItem>
        <NavIslandItem>Tab 2</NavIslandItem>
      </NavIsland>,
    );

    const activeItem = screen.getByRole("button", { name: "Tab 1" });
    expect(activeItem.getAttribute("data-active")).toBe("true");
    expect(activeItem.className).toContain("!bg-charcoal-hover");
  });

  it("supports custom size and variant props", () => {
    render(
      <NavIsland size="sm" variant="subtle" aria-label="Compact">
        <NavIslandItem size="sm">Small</NavIslandItem>
      </NavIsland>,
    );

    const nav = screen.getByRole("navigation", { name: "Compact" });
    expect(nav.className).toContain("p-[1px]");
    expect(nav.className).toContain("rounded-md");

    const item = screen.getByRole("button", { name: "Small" });
    expect(item.className).toContain("h-5");
    expect(item.className).toContain("px-1.5");
    expect(item.className).toContain("text-[11px]");
  });
});
