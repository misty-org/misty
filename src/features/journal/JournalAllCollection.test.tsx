import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { JournalCollection } from "./notes/components/JournalCollection";
vi.mock("@/features/auth", () => ({
  accountScopeResetEvent: "test-reset",
  useAuth: () => ({ user: { id: "me" } }),
}));
vi.mock("@/features/spaces/useSpaceItemCreator", () => ({
  useSpaceItemCreator: () => () => "Alex",
}));
vi.mock("@/features/spaces/useSpaceOverview", () => ({
  useSpaceOverview: () => ({
    loading: false,
    failed: false,
    retry: vi.fn(),
    items: [
      {
        id: "note:same",
        title: "Weekly notes",
        kind: "note",
        area: "Journal",
        updatedAt: "2026-10-01",
        route: "/spaces/test/notes?note=same&view=doc",
      },
      {
        id: "drawing:same",
        title: "Weekend sketch",
        kind: "drawing",
        area: "Journal",
        updatedAt: "2026-09-30",
        route: "/spaces/test/drawings/same",
      },
      {
        id: "task:other",
        title: "Not a journal item",
        kind: "task",
        area: "Planner",
        updatedAt: "2026-09-30",
        route: "/spaces/test/planner",
      },
    ],
  }),
}));
function Route() {
  const location = useLocation();
  return (
    <output data-testid="route">
      {location.pathname}
      {location.search}
    </output>
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
});
const props = {
  spaceId: "test",
  notes: [],
  loading: false,
  error: false,
  onRetry: vi.fn(),
  query: "",
  onQueryChange: vi.fn(),
  pinnedIds: new Set<string>(),
  readOnly: true,
  onCreate: vi.fn(),
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onTogglePin: vi.fn(),
  onDelete: vi.fn(),
};
it("defaults to All and combines Journal types with their original destinations", () => {
  render(
    <MemoryRouter initialEntries={["/spaces/test/notes"]}>
      <JournalCollection {...props} />
      <Route />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "All", pressed: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Weekly notes" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Not a journal item" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Weekend sketch" }));
  expect(screen.getByTestId("route").textContent).toBe("/spaces/test/drawings/same");
});
it("keeps Notes available as a separate section and applies search to All", () => {
  const ui = render(
    <MemoryRouter initialEntries={["/spaces/test/notes"]}>
      <JournalCollection {...props} query="sketch" />
      <Route />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button", { name: "Weekly notes" })).toBeNull();
  expect(screen.getByRole("button", { name: "Weekend sketch" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Notes" }));
  expect(screen.getByTestId("route").textContent).toBe("/spaces/test/notes?section=notes");
  expect(ui.queryByRole("button", { name: "Weekend sketch" })).toBeNull();
});

it("combines existing note and drawing pins in Pinned", () => {
  localStorage.setItem("misty:drawing-pins:me:test", JSON.stringify(["same"]));
  render(
    <MemoryRouter initialEntries={["/spaces/test/notes?section=pinned"]}>
      <JournalCollection {...props} pinnedIds={new Set(["misty:same"])} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Pinned", pressed: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Weekly notes" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Weekend sketch" })).toBeTruthy();
});
