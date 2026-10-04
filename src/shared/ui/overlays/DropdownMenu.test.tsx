import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./DropdownMenu";
import { MenuItem, MenuSubmenu } from "./MenuItem";

afterEach(cleanup);

it("keeps submenus outside the scrolling parent and preserves keyboard selection", async () => {
  const select = vi.fn();
  render(
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger>Browser menu</DropdownMenuTrigger>
      <DropdownMenuContent aria-label="Browser menu" style={{ maxHeight: 120 }}>
        <MenuSubmenu label="Bookmarks">
          <MenuItem label="Bookmark manager" onSelect={select} />
        </MenuSubmenu>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Browser menu" }), { key: "Enter" });
  const parent = await screen.findByRole("menu", { name: "Browser menu" });
  const trigger = screen.getByRole("menuitem", { name: "Bookmarks" });
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  const item = await screen.findByRole("menuitem", { name: "Bookmark manager" });
  const submenu = item.closest('[role="menu"]');
  expect(submenu).not.toBeNull();
  expect(parent.contains(submenu)).toBe(false);
  expect(document.body.contains(submenu)).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(item));
  fireEvent.keyDown(item, { key: "ArrowLeft" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  const reopenedItem = await screen.findByRole("menuitem", { name: "Bookmark manager" });
  fireEvent.keyDown(reopenedItem, { key: "Enter" });
  expect(select).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
