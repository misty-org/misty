import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArrowDownAZ, Clock, GitFork, Pencil, Pin, Trash2 } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./DropdownMenu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
} from "./ContextMenu";
import {
  MenuCheckItem,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "./MenuItem";
import { RowActions } from "./RowActions";

afterEach(cleanup);

function Menu({ context }: { context: boolean }) {
  const [value, setValue] = useState("recent");
  const Root = context ? ContextMenu : DropdownMenu;
  const Trigger = context ? ContextMenuTrigger : DropdownMenuTrigger;
  const Content = context ? ContextMenuContent : DropdownMenuContent;
  const Group = context ? ContextMenuRadioGroup : DropdownMenuRadioGroup;
  const Item = context ? ContextMenuRadioItem : DropdownMenuRadioItem;
  return (
    <Root>
      <Trigger asChild>
        <button>Sort</button>
      </Trigger>
      <Content>
        <Group value={value} onValueChange={setValue}>
          <Item value="recent" onSelect={(event) => event.preventDefault()}>
            Recent
          </Item>
          <Item value="name" onSelect={(event) => event.preventDefault()}>
            Name
          </Item>
        </Group>
      </Content>
    </Root>
  );
}

it.each([false, true])("uses checkmarks and preserves single selection (context=%s)", (context) => {
  render(<Menu context={context} />);
  const trigger = screen.getByRole("button", { name: "Sort" });
  if (context) fireEvent.contextMenu(trigger);
  else fireEvent.keyDown(trigger, { key: "Enter" });
  const recent = screen.getByRole("menuitemradio", { name: "Recent" });
  const name = screen.getByRole("menuitemradio", { name: "Name" });
  expect(recent.getAttribute("aria-checked")).toBe("true");
  expect(recent.querySelector("svg.lucide-check")).toBeTruthy();
  expect(recent.querySelector("circle")).toBeNull();
  expect(name.querySelector("svg")).toBeNull();
  fireEvent.click(name);
  expect(name.getAttribute("aria-checked")).toBe("true");
  expect(name.querySelector("svg.lucide-check")).toBeTruthy();
  expect(recent.getAttribute("aria-checked")).toBe("false");
  expect(recent.querySelector("svg")).toBeNull();
});

function Rows({ onRename, onDelete }: { onRename?: () => void; onDelete?: () => void }) {
  const [sort, setSort] = useState("recent");
  const [pinned, setPinned] = useState(false);
  return (
    <>
      <MenuItem icon={Pencil} label="Rename" shortcut="R" onSelect={onRename} />
      <MenuItem icon={GitFork} label="Fork" disabled reason="Wait for the run to finish" />
      <MenuCheckItem icon={Pin} label="Pinned" checked={pinned} onCheckedChange={setPinned} />
      <MenuSeparator />
      <MenuLabel>Sort by</MenuLabel>
      <MenuRadioGroup value={sort} onValueChange={setSort}>
        <MenuRadioItem icon={Clock} value="recent" label="Recent" />
        <MenuRadioItem icon={ArrowDownAZ} value="name" label="Name" />
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete" danger onSelect={onDelete} />
    </>
  );
}

function openMenu(context: boolean) {
  const trigger = screen.getByRole("button", { name: "Open" });
  if (context) fireEvent.contextMenu(trigger);
  else fireEvent.keyDown(trigger, { key: "Enter" });
}

it.each([false, true])("renders one tree of rows in either menu (context=%s)", (context) => {
  const Root = context ? ContextMenu : DropdownMenu;
  const Trigger = context ? ContextMenuTrigger : DropdownMenuTrigger;
  const Content = context ? ContextMenuContent : DropdownMenuContent;
  render(
    <Root>
      <Trigger asChild>
        <button>Open</button>
      </Trigger>
      <Content>
        <Rows />
      </Content>
    </Root>,
  );
  openMenu(context);
  const rename = screen.getByRole("menuitem", { name: /Rename/ });
  // Every row starts with its 16px icon.
  expect(rename.firstElementChild?.matches("svg.lucide-pencil")).toBe(true);
  // Rows read at the control size, in either kind of menu.
  expect(rename.className.split(" ")).toEqual(
    expect.arrayContaining(["text-control", "text-cream"]),
  );
  expect(rename.getAttribute("data-slot")).toBe(
    context ? "context-menu-item" : "dropdown-menu-item",
  );

  const remove = screen.getByRole("menuitem", { name: "Delete" });
  expect(remove.getAttribute("data-variant")).toBe("danger");

  const fork = screen.getByRole("menuitem", { name: "Fork" });
  expect(fork.getAttribute("data-disabled")).not.toBeNull();

  // Selection is a checkmark at the right edge, after the label, never a dot.
  const pinned = screen.getByRole("menuitemcheckbox", { name: "Pinned" });
  expect(pinned.querySelector("svg.lucide-check")).toBeNull();
  fireEvent.click(pinned);
  expect(pinned.getAttribute("aria-checked")).toBe("true");
  expect(pinned.lastElementChild?.querySelector("svg.lucide-check")).toBeTruthy();
  // A check row stays open so several can be toggled in one go.
  expect(screen.getByRole("menu")).toBeTruthy();

  const recent = screen.getByRole("menuitemradio", { name: "Recent" });
  const name = screen.getByRole("menuitemradio", { name: "Name" });
  expect(recent.firstElementChild?.matches("svg.lucide-clock")).toBe(true);
  expect(recent.lastElementChild?.querySelector("svg.lucide-check")).toBeTruthy();
  expect(recent.querySelector("circle:not(.lucide-clock circle)")).toBeNull();
  expect(name.querySelector("svg.lucide-check")).toBeNull();
});

it("explains a disabled row in a tooltip", async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button>Open</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <Rows />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  openMenu(false);
  const fork = screen.getByRole("menuitem", { name: "Fork" });
  fireEvent.pointerMove(fork, { pointerType: "mouse" });
  expect(
    await screen.findByRole("tooltip", {}, { timeout: 2000 }).then((tip) => tip.textContent),
  ).toContain("Wait for the run to finish");
});

it("opens the same row actions from the ⋯ and from a right-click", async () => {
  const rename = vi.fn();
  const open = vi.fn();
  render(
    <div className="group/row flex" onClick={open}>
      <span>Weekly notes</span>
      <RowActions label="Chat actions">
        <Rows onRename={rename} />
      </RowActions>
    </div>,
  );
  const more = screen.getByRole("button", { name: "Chat actions" });
  fireEvent.click(more);
  expect(open).not.toHaveBeenCalled();

  fireEvent.keyDown(more, { key: "Enter" });
  const dropdown = await screen.findByRole("menu", { name: "Chat actions" });
  expect(dropdown.getAttribute("data-slot")).toBe("dropdown-menu-content");
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  fireEvent.keyDown(dropdown, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  fireEvent.contextMenu(screen.getByText("Weekly notes"), { clientX: 40, clientY: 20 });
  const contextMenu = await screen.findByRole("menu", { name: "Chat actions" });
  expect(contextMenu.getAttribute("data-slot")).toBe("context-menu-content");
  fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
  expect(rename).toHaveBeenCalledOnce();
});
