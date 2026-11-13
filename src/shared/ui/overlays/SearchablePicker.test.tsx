import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Cloud, GitBranch, Plus } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SearchablePicker, type SearchablePickerOption } from "./SearchablePicker";

afterEach(cleanup);
// cmdk scrolls the highlighted row into view; jsdom has no layout to scroll.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
});

const options: SearchablePickerOption[] = [
  { id: "local:main", value: "main", label: "main", icon: GitBranch },
  { id: "local:feature", value: "feature", label: "feature", icon: GitBranch },
  { id: "remote:release", value: "release", label: "release", icon: Cloud },
];

function picker(props: Partial<Parameters<typeof SearchablePicker>[0]> = {}) {
  return render(
    <SearchablePicker
      label="Branch"
      icon={GitBranch}
      options={options}
      value="main"
      searchLabel="Search branches"
      emptyLabel="No branches match"
      onPick={vi.fn()}
      {...props}
    />,
  );
}

const openList = () => fireEvent.click(screen.getByRole("button", { name: "Branch" }));

describe("SearchablePicker", () => {
  it("shows the pick on its trigger and tells as it opens", () => {
    const onOpen = vi.fn();
    picker({ onOpen });
    expect(screen.getByRole("button", { name: "Branch" }).textContent).toContain("main");
    openList();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByPlaceholderText("Search branches")).toBeTruthy();
    expect(screen.getByRole("option", { name: "main" }).getAttribute("data-checked")).toBe("true");
  });

  it("narrows the rows as the search is typed and picks one", () => {
    const onPick = vi.fn();
    picker({ onPick });
    openList();
    fireEvent.change(screen.getByPlaceholderText("Search branches"), {
      target: { value: "rel" },
    });
    expect(screen.queryByRole("option", { name: "feature" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "release" }));
    expect(onPick).toHaveBeenCalledWith("release");
    expect(screen.queryByPlaceholderText("Search branches")).toBeNull();
  });

  it("says when nothing matches", () => {
    picker();
    openList();
    fireEvent.change(screen.getByPlaceholderText("Search branches"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No branches match")).toBeTruthy();
  });

  it("shows skeleton rows while the options are read, and its actions after them", () => {
    const onSelect = vi.fn();
    picker({ options: undefined, actions: [{ icon: Plus, label: "New branch", onSelect }] });
    openList();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "New branch" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("opens from an element of your own", () => {
    picker({ trigger: <button type="button">main branch</button> });
    fireEvent.click(screen.getByRole("button", { name: "main branch" }));
    expect(screen.getByPlaceholderText("Search branches")).toBeTruthy();
  });
});
