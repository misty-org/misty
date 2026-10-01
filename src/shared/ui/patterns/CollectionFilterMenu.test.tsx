import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  CollectionFilterMenu,
  defaultCollectionRefinement,
  refineCollection,
  useCollectionRefinement,
} from "./CollectionFilterMenu";

const rows = [
  { title: "Zebra", date: "2026-10-01T12:00:00Z", kind: "note" },
  { title: "Alpha", date: "2026-09-30T12:00:00Z", kind: "drawing" },
  { title: "Old", date: "2026-08-01T12:00:00Z", kind: "note" },
  { title: "Undated", date: "", kind: "note" },
];
const fields = {
  title: (row: (typeof rows)[number]) => row.title,
  date: (row: (typeof rows)[number]) => row.date,
  facet: (row: (typeof rows)[number]) => row.kind,
};
afterEach(cleanup);

it("combines type and rolling date filters without changing source data", () => {
  const result = refineCollection(
    rows,
    { period: "7", sort: "name", facet: "note" },
    fields,
    Date.parse("2026-10-02T12:00:00Z"),
  );
  expect(result.map((row) => row.title)).toEqual(["Zebra"]);
  expect(rows.map((row) => row.title)).toEqual(["Zebra", "Alpha", "Old", "Undated"]);
});
it("sorts dates in both directions and always leaves undated items last", () => {
  expect(
    refineCollection(rows, { ...defaultCollectionRefinement, sort: "oldest" }, fields).map(
      (row) => row.title,
    ),
  ).toEqual(["Old", "Alpha", "Zebra", "Undated"]);
  expect(
    refineCollection(rows, { ...defaultCollectionRefinement, sort: "recent" }, fields).map(
      (row) => row.title,
    ),
  ).toEqual(["Zebra", "Alpha", "Old", "Undated"]);
});
it("applies checkmarked menu filters and resets an empty result", () => {
  function Collection() {
    const refinement = useCollectionRefinement(rows, {
      ...fields,
      label: "Filter entries",
      facet: {
        label: "Type",
        value: fields.facet,
        options: [
          { value: "all", label: "All types" },
          { value: "missing", label: "Files" },
        ],
      },
    });
    return (
      <>
        {refinement.control}
        <output>{refinement.items.length} entries</output>
      </>
    );
  }
  render(<Collection />);
  const open = () =>
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter entries" }), {
      button: 0,
      ctrlKey: false,
    });
  open();
  const selected = screen.getByRole("menuitemradio", { name: "All types" });
  expect(selected.getAttribute("aria-checked")).toBe("true");
  expect(selected.querySelector(".lucide-check")).toBeTruthy();
  expect(selected.querySelector(".lucide-circle")).toBeNull();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Files" }));
  expect(screen.getByText("0 entries")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Filter entries" }).getAttribute("data-active")).toBe(
    "true",
  );
  open();
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset filters" }));
  expect(screen.getByText("4 entries")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Filter entries" }).getAttribute("data-active"),
  ).toBeNull();
});

it("counts narrowing filters, excludes sorting, and hides the badge after reset", () => {
  const groups = [
    {
      label: "Status",
      value: "done",
      options: [
        { value: "all", label: "All" },
        { value: "done", label: "Done" },
      ],
      onChange: () => {},
    },
    {
      label: "Priority",
      value: "high",
      options: [
        { value: "all", label: "All" },
        { value: "high", label: "High" },
      ],
      onChange: () => {},
    },
    {
      label: "Sort by",
      kind: "sort" as const,
      value: "name",
      options: [
        { value: "default", label: "Default" },
        { value: "name", label: "Name" },
      ],
      onChange: () => {},
    },
  ];
  const ui = render(
    <CollectionFilterMenu label="Filter tasks" groups={groups} active onReset={() => {}} />,
  );
  const trigger = screen.getByRole("button", { name: "Filter tasks" });
  expect(trigger.getAttribute("aria-description")).toBe("2 active filters");
  expect(trigger.querySelector('[data-slot="badge"]')?.textContent).toBe("2");
  ui.rerender(
    <CollectionFilterMenu
      label="Filter tasks"
      groups={groups.map((group) => ({ ...group, value: group.options[0].value }))}
      active={false}
      onReset={() => {}}
    />,
  );
  expect(trigger.querySelector('[data-slot="badge"]')).toBeNull();
});
