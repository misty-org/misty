import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useSpaceOverviewActions } from "./useSpaceOverviewActions";
import type { SpaceOverviewItem } from "./useSpaceOverview";
const access = vi.hoisted(() => ({ referenceOnly: false }));
vi.mock("./store/useSpacesStore", () => ({
  useSpacesStore: (selector: (state: typeof access) => unknown) => selector(access),
}));
vi.mock("@/features/journal/drawings/collaboration/drawingCollaboration", () => ({
  closeDrawingCollaborationSession: vi.fn(),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  access.referenceOnly = false;
});

function Harness({ item, refresh = () => {} }: { item: SpaceOverviewItem; refresh?: () => void }) {
  const actions = useSpaceOverviewActions("user", "space", [item], refresh);
  const location = useLocation();
  return (
    <>
      {actions.forItem(item).actions}
      {actions.dialog}
      <output>
        {location.pathname}
        {location.search}
      </output>
      {actions.error && <p role="alert">{actions.error}</p>}
    </>
  );
}
const item = {
  id: "drawing:d",
  title: "Sketch",
  area: "Journal",
  kind: "drawing",
  updatedAt: "2026-09-30",
  route: "/spaces/space/drawings/d",
} satisfies SpaceOverviewItem;
const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: /More actions/ }), {
    button: 0,
    ctrlKey: false,
  });

it("shares Journal pins without pruning pins outside the overview", async () => {
  localStorage.setItem("misty:drawing-pins:user:space", JSON.stringify(["outside"]));
  render(
    <MemoryRouter>
      <Harness item={item} />
    </MemoryRouter>,
  );
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem("misty:drawing-pins:user:space")!)).toEqual([
      "d",
      "outside",
    ]),
  );
  openMenu();
  expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeTruthy();
});

it("renames from the menu, preserves a failed draft and retries", async () => {
  const rename = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({});
  const refresh = vi.fn();
  render(
    <MemoryRouter>
      <Harness item={{ ...item, rename }} refresh={refresh} />
    </MemoryRouter>,
  );
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New sketch" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("New sketch");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(rename).toHaveBeenLastCalledWith("New sketch");
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("requires confirmation before deletion and disables unauthorized mutations", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <MemoryRouter>
      <Harness item={{ ...item, remove }} />
    </MemoryRouter>,
  );
  openMenu();
  expect(screen.getByRole("menuitem", { name: "Rename" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  access.referenceOnly = true;
  view.rerender(
    <MemoryRouter>
      <Harness item={{ ...item, remove, rename: vi.fn() }} />
    </MemoryRouter>,
  );
  openMenu();
  for (const name of ["Rename", "Delete"])
    expect(screen.getByRole("menuitem", { name }).getAttribute("aria-disabled")).toBe("true");
});

it("opens note rename in its collaborative editor", () => {
  render(
    <MemoryRouter>
      <Harness
        item={{
          ...item,
          id: "note:n",
          kind: "note",
          renameRoute: "/spaces/space/notes?note=n&view=doc&rename=1",
        }}
      />
    </MemoryRouter>,
  );
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  expect(screen.getByRole("status").textContent).toContain("rename=1");
});

it.each([
  ["task", "Archive"],
  ["file", "Move to Trash"],
] as const)("uses the correct removal operation for %s", (kind, label) => {
  render(
    <MemoryRouter>
      <Harness item={{ ...item, kind, remove: vi.fn() }} />
    </MemoryRouter>,
  );
  openMenu();
  expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
});

it("uses the same native note pin IDs as the Notes collection", async () => {
  localStorage.setItem("misty:note-pins:user:space", JSON.stringify(["misty:n"]));
  render(
    <MemoryRouter>
      <Harness item={{ ...item, id: "note:n", kind: "note" }} />
    </MemoryRouter>,
  );
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem("misty:note-pins:user:space")!)).toEqual([]),
  );
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem("misty:note-pins:user:space")!)).toEqual(["misty:n"]),
  );
});
