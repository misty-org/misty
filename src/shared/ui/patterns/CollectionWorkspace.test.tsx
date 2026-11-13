import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { List, Pencil, Plus, Trash2 } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { MenuItem } from "../overlays/MenuItem";
import { RenameItemDialog } from "./RenameItemDialog";
import {
  CollectionHeading,
  CollectionItems,
  CollectionFilters,
  CollectionPage,
  CollectionSortMenu,
  CollectionViewToggle,
} from "./CollectionWorkspace";

const openMenu = (trigger: HTMLElement) =>
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

afterEach(cleanup);

it("opens from metadata cells while keeping actions independent and headers aligned", () => {
  const onOpen = vi.fn();
  const onAction = vi.fn();
  render(
    <CollectionItems
      items={[
        {
          id: "note",
          title: "Team note",
          icon: null,
          category: "Note",
          creator: "Sam",
          updated: "Sep 30",
          onOpen,
          menuLabel: "Note actions",
          menu: <MenuItem icon={Pencil} label="Rename" onSelect={onAction} />,
        },
      ]}
    />,
  );
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Name",
    "Area",
    "Created by",
    "Last activity",
    "Actions",
  ]);
  const row = screen.getAllByRole("row")[1];
  expect(
    within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["Team note", "Note", "Sam", "Sep 30", ""]);
  fireEvent.click(within(row).getByText("Sam", { exact: true }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Team note" }));
  expect(onOpen).toHaveBeenCalledTimes(2);
  openMenu(screen.getByRole("button", { name: "Note actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledTimes(2);
});

it("switches sections directly without a redundant filter menu", () => {
  const onChange = vi.fn();
  render(
    <CollectionFilters
      options={[
        { value: "notes", label: "Notes" },
        { value: "drawings", label: "Drawings" },
      ]}
      value="notes"
      onChange={onChange}
    />,
  );
  expect(screen.queryByRole("button", { name: "Filter collection" })).toBeNull();
  expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Drawings" }));
  expect(onChange).toHaveBeenCalledWith("drawings");
});

it.each(["preview", "compact"] as const)(
  "keeps %s grid metadata and full titles available, with independent item actions",
  (gridLayout) => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    const title = "A very long collaborative document title that should fade at the edge";
    render(
      <CollectionItems
        view="grid"
        gridLayout={gridLayout}
        items={[
          {
            id: "note",
            title,
            icon: <span>Note icon</span>,
            category: "Journal",
            updated: "Sep 30",
            creator: "Sam",
            onOpen,
            menuLabel: "Note actions",
            menu: <MenuItem icon={Pencil} label="Rename" onSelect={onAction} />,
          },
        ]}
      />,
    );
    const card = screen.getByRole("button", { name: title });
    expect(within(card).getByText("Sep 30")).toBeTruthy();
    expect(within(card).getByText("Created by Sam")).toBeTruthy();
    // The whole title stays the card's name; it fades instead of being cut with an ellipsis.
    expect(within(card).getByText(title)).toBeTruthy();
    expect(document.querySelector("[title]")).toBeNull();
    openMenu(screen.getByRole("button", { name: "Note actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
  },
);

it("sorts every data column, keeps unknown dates last, and cycles back to source order", () => {
  const onOpen = vi.fn();
  const rows = [
    {
      id: "a",
      title: "Zebra",
      category: "Note",
      creator: "Alex",
      updated: "Dec 31",
      updatedAt: "2025-12-31",
      icon: null,
      onOpen,
    },
    {
      id: "b",
      title: "Alpha",
      category: "Drawing",
      creator: "Zoe",
      updated: "Jan 1",
      updatedAt: "2026-01-01",
      icon: null,
      onOpen,
    },
    {
      id: "c",
      title: "Beta",
      category: "Task",
      creator: "Morgan",
      updated: "—",
      icon: null,
      onOpen,
    },
  ];
  render(<CollectionItems items={rows} />);
  const names = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  expect(names()).toEqual(["Alpha", "Beta", "Zebra"]);
  expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe(
    "ascending",
  );
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  expect(names()).toEqual(["Zebra", "Beta", "Alpha"]);
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  expect(names()).toEqual(["Zebra", "Alpha", "Beta"]);
  fireEvent.click(screen.getByRole("button", { name: "Area" }));
  expect(names()).toEqual(["Alpha", "Zebra", "Beta"]);
  fireEvent.click(screen.getByRole("button", { name: "Created by" }));
  expect(names()).toEqual(["Zebra", "Beta", "Alpha"]);
  fireEvent.click(screen.getByRole("button", { name: "Last activity" }));
  expect(names()).toEqual(["Zebra", "Alpha", "Beta"]);
  fireEvent.click(screen.getByRole("button", { name: "Last activity" }));
  expect(names()).toEqual(["Alpha", "Zebra", "Beta"]);
  expect(onOpen).not.toHaveBeenCalled();
});

it("sorts incoming rows and discards header sorting when the menu ordering changes", () => {
  const item = (id: string) => ({
    id,
    title: id,
    category: "Note",
    updated: "—",
    icon: null,
    onOpen: vi.fn(),
  });
  const ui = render(<CollectionItems items={[item("Z"), item("B")]} sortResetKey="default" />);
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  ui.rerender(<CollectionItems items={[item("Z"), item("B"), item("A")]} sortResetKey="default" />);
  expect(screen.getAllByRole("row")[1].textContent).toContain("A");
  ui.rerender(<CollectionItems items={[item("Z"), item("B")]} sortResetKey="recent" />);
  expect(screen.getAllByRole("row")[1].textContent).toContain("Z");
  expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe("none");
  ui.rerender(<CollectionItems items={[item("Z"), item("B")]} sortResetKey="default" />);
  expect(screen.getAllByRole("row")[1].textContent).toContain("Z");
});

it("chooses columns independently per collection, preserves empty schemas, and resets defaults", () => {
  const ui = (id = "notes", empty = false) => (
    <CollectionPage>
      <CollectionFilters options={[]} value="" onChange={() => {}} />
      <CollectionItems
        columnSetId={id}
        fields={["Size", "Created"]}
        items={
          empty
            ? []
            : [
                {
                  id: "a",
                  title: "A",
                  category: "Note",
                  updated: "—",
                  icon: null,
                  onOpen: vi.fn(),
                  metadata: { Size: "10 KB", Created: "Oct 1" },
                  sortValues: { Size: 10000 },
                },
                {
                  id: "b",
                  title: "B",
                  category: "Note",
                  updated: "—",
                  icon: null,
                  onOpen: vi.fn(),
                  metadata: { Size: "2 KB", Created: "Sep 30" },
                  sortValues: { Size: 2000 },
                },
              ]
        }
      />
    </CollectionPage>
  );
  const rendered = render(ui());
  fireEvent.click(screen.getByRole("button", { name: "Size" }));
  expect(screen.getAllByRole("row")[1].textContent).toContain("B");
  const open = () =>
    fireEvent.pointerDown(screen.getByRole("button", { name: "Choose columns" }), {
      button: 0,
      ctrlKey: false,
    });
  open();
  expect(screen.getByRole("menuitemcheckbox", { name: "Name" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  const size = screen.getByRole("menuitemcheckbox", { name: "Size" });
  expect(size.querySelector(".lucide-check")).toBeTruthy();
  fireEvent.click(size);
  expect(screen.queryByRole("columnheader", { name: "Size" })).toBeNull();
  expect(screen.getByRole("menuitemcheckbox", { name: "Size" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  fireEvent.keyDown(size, { key: "Escape" });
  expect(screen.getAllByRole("row")[1].textContent).toContain("A");
  rendered.rerender(ui("drawings"));
  expect(screen.getByRole("columnheader", { name: "Size" })).toBeTruthy();
  rendered.rerender(ui("notes", true));
  expect(screen.queryByRole("columnheader", { name: "Size" })).toBeNull();
  open();
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset columns" }));
  expect(screen.getByRole("columnheader", { name: "Size" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Created" })).toBeTruthy();
});

it.each(["list", "grid"] as const)(
  "gives each %s item one menu, from its ⋯ and from a right-click",
  (view) => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const onMenuOpen = vi.fn();
    render(
      <CollectionItems
        view={view}
        items={[
          {
            id: "note",
            title: "Team note",
            category: "Note",
            updated: "Sep 30",
            onOpen,
            onMenuOpen,
            menuLabel: "Note actions",
            menu: (
              <>
                <MenuItem icon={Pencil} label="Rename" onSelect={onRename} />
                <MenuItem icon={Trash2} label="Delete" danger />
              </>
            ),
          },
        ]}
      />,
    );
    const more = screen.getByRole("button", { name: "Note actions" });
    openMenu(more);
    expect(screen.getByRole("menu", { name: "Note actions" })).toBeTruthy();
    expect(onMenuOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    // The same rows open from a right-click anywhere on the item.
    fireEvent.contextMenu(screen.getByRole("button", { name: "Team note" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  },
);

it("draws list rows text first, with no icon tile and no native titles", () => {
  render(
    <CollectionItems
      items={[
        {
          id: "note",
          title: "Team note",
          icon: <svg data-testid="glyph" />,
          category: "Note",
          creator: "Sam",
          creatorDescription: "Added by Sam",
          updated: "Sep 30",
          onOpen: vi.fn(),
          metadata: { Size: "10 KB" },
        },
      ]}
      fields={["Size"]}
    />,
  );
  const row = screen.getAllByRole("row")[1];
  expect(within(row).queryByTestId("glyph")).toBeNull();
  expect(within(row).getAllByRole("cell")[0].textContent).toBe("Team note");
  expect(document.querySelector("[title]")).toBeNull();
});

it("starts list rows with the item's icon tile in its tone when asked", () => {
  render(
    <CollectionItems
      listIcons
      items={[
        {
          id: "note",
          title: "Team note",
          icon: <svg data-testid="glyph" />,
          tone: "blue",
          category: "Note",
          updated: "Sep 30",
          onOpen: vi.fn(),
        },
      ]}
    />,
  );
  const row = screen.getAllByRole("row")[1];
  const tile = within(row).getByTestId("glyph").parentElement!;
  expect(tile.dataset.slot).toBe("collection-row-icon");
  expect(tile.className).toContain("text-tone-blue");
  expect(within(row).getByRole("button", { name: "Team note" })).toBeTruthy();
});

it("lets compact cards take two lines for their titles", () => {
  const { container } = render(
    <CollectionItems
      view="grid"
      gridLayout="compact"
      cardTitleLines={2}
      items={[
        {
          id: "a",
          title: "A long title",
          icon: <svg />,
          category: "Note",
          updated: "Sep 30",
          onOpen: vi.fn(),
        },
      ]}
    />,
  );
  expect(container.querySelector(".fade-end-2, [class*='max-h-[2lh]']")).toBeTruthy();
});

it("heads a page with a PageHeader that never wraps, keeping loose controls at its end", () => {
  const create = vi.fn();
  const ui = render(
    <CollectionHeading
      title="Journal"
      actions={[{ id: "new", icon: Plus, label: "New note", priority: 1, onSelect: create }]}
      end={<input aria-label="Search notes" />}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Journal" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New note" }));
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Search notes" })).toBeTruthy();
  ui.rerender(<CollectionHeading title={<span>Space switcher</span>} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Space switcher");
  expect(document.querySelector(".flex-wrap")).toBeNull();
});

it("keeps the section tabs and utilities on one bar that never wraps", () => {
  render(
    <CollectionFilters
      options={[
        { value: "notes", label: "Notes" },
        { value: "drawings", label: "Drawings" },
      ]}
      value="notes"
      onChange={() => {}}
      actions={<CollectionViewToggle value="list" onChange={() => {}} />}
    />,
  );
  const bar = screen.getByRole("toolbar", { name: "Collection controls" });
  expect(within(bar).getByRole("button", { name: "Drawings" })).toBeTruthy();
  expect(within(bar).getByRole("group", { name: "View layout" })).toBeTruthy();
  expect(document.querySelector(".flex-wrap")).toBeNull();
  expect(document.querySelector("[title]")).toBeNull();
});

it("chooses grid or list as bare pressed icons and keeps the board a separate button", () => {
  const onChange = vi.fn();
  const onBoardView = vi.fn();
  render(<CollectionViewToggle value="list" onChange={onChange} onBoardView={onBoardView} />);
  const group = screen.getByRole("group", { name: "View layout" });
  expect(
    within(group).getByRole("button", { name: "List view" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    within(group).getByRole("button", { name: "Grid view" }).getAttribute("aria-pressed"),
  ).toBe("false");
  // No box around the pair: the buttons are quiet, with no border or fill of their own.
  expect(within(group).getByRole("button", { name: "List view" }).dataset.variant).toBe("quiet");
  fireEvent.click(within(group).getByRole("button", { name: "Grid view" }));
  expect(onChange).toHaveBeenCalledWith("grid");
  fireEvent.click(screen.getByRole("button", { name: "Board view" }));
  expect(onBoardView).toHaveBeenCalledTimes(1);
});

it("sorts from one icon whose tooltip names the order in use", () => {
  render(
    <CollectionSortMenu
      value="title"
      options={[
        { value: "recent", label: "Most recent", icon: List },
        { value: "title", label: "Title", icon: List },
      ]}
      onChange={() => {}}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Sort: Title" });
  expect(trigger.textContent).toBe("");
});

it("shows a failed rename under the name field and keeps the dialog open", async () => {
  const onClose = vi.fn();
  render(
    <RenameItemDialog
      title="Rename drawing"
      initialName="Sketch"
      onConfirm={() => Promise.reject(new Error("You no longer have permission."))}
      onClose={onClose}
    />,
  );
  const field = screen.getByRole("textbox", { name: "Name" });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByText("You no longer have permission.")).toBeTruthy());
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(onClose).not.toHaveBeenCalled();
});
