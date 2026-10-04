import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionItems, CollectionFilters, CollectionPage } from "./CollectionWorkspace";

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
          actions: <button onClick={onAction}>More actions</button>,
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
  ).toEqual(["Team note", "Note", "Sam", "Sep 30", "More actions"]);
  fireEvent.click(within(row).getByText("Sam", { exact: true }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Team note" }));
  expect(onOpen).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
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
            actions: <button onClick={onAction}>More actions</button>,
          },
        ]}
      />,
    );
    const card = screen.getByRole("button", { name: title });
    expect(within(card).getByText("Sep 30")).toBeTruthy();
    expect(within(card).getByText("Created by Sam")).toBeTruthy();
    expect(screen.getByTitle(title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
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
