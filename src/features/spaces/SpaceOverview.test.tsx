import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { SpaceOverview } from "./SpaceOverview";
vi.mock("@/features/auth", () => ({
  accountScopeResetEvent: "misty:test-account-reset",
  useAuth: () => ({ user: { id: "user" } }),
}));
const overview = vi.hoisted(() => ({
  items: [] as {
    id: string;
    title: string;
    area: string;
    kind: string;
    updatedAt: string;
    route: string;
    creatorUserId?: string;
  }[],
  loading: false,
  failed: false,
  retry: vi.fn(),
}));
vi.mock("./useSpaceOverview", () => ({ useSpaceOverview: () => overview }));
vi.mock("./useSpacePersonalItems", () => ({
  useSpacePersonalItems: () => ({
    items: [{ item_key: "a", favorite: true }],
    ready: true,
    error: "",
    update: vi.fn(),
    retry: vi.fn(),
  }),
}));
vi.mock("./components/SpaceCreateMenu", () => ({ SpaceCreateMenu: () => null }));
afterEach(() => {
  cleanup();
  overview.items = [];
});
it("uses ownership filters without tool shortcuts", () => {
  const space: Space = {
    id: "restricted",
    is_default: false,
    owner_user_id: "owner",
    name: "Restricted",
    role: "member",
    member_count: 2,
    pending_count: 0,
    is_shared: true,
    created_at: "2026-09-30T12:00:00Z",
    updated_at: "2026-09-30T12:00:00Z",
    permissions: { "messages.read": false, "tasks.view": false, "library.view": false },
  };
  render(
    <MemoryRouter>
      <SpaceOverview space={space} />
    </MemoryRouter>,
  );
  for (const name of ["Chat", "Planner", "Library"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByRole("button", { name: "Journal" })).toBeNull();
  expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
});

function RouteLocation() {
  const location = useLocation();
  return (
    <output aria-label="Current route">
      {location.pathname}
      {location.search}
    </output>
  );
}
function renderOverview() {
  const space = {
    id: "one",
    name: "Personal",
    permissions: {},
    is_default: true,
    owner_user_id: "user",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: false,
    created_at: "2026-09-30",
    updated_at: "2026-09-30",
  } satisfies Space;
  return render(
    <MemoryRouter>
      <SpaceOverview space={space} />
      <RouteLocation />
    </MemoryRouter>,
  );
}
it("searches, filters, sorts and switches views over real item links", () => {
  overview.items = [
    {
      id: "a",
      creatorUserId: "user",
      title: "Zebra plan",
      area: "Planner",
      kind: "task",
      updatedAt: "2026-09-30",
      route: "/spaces/one/planner/tasks/list?task=a",
    },
    {
      id: "b",
      creatorUserId: "user",
      title: "Alpha note",
      area: "Journal",
      kind: "note",
      updatedAt: "2026-09-29",
      route: "/spaces/one/notes?note=b&view=doc",
    },
  ];
  const ui = renderOverview();
  fireEvent.change(ui.getByRole("textbox", { name: "Search this space" }), {
    target: { value: "Alpha" },
  });
  expect(ui.queryByRole("button", { name: "Zebra plan" })).toBeNull();
  fireEvent.change(ui.getByRole("textbox", { name: "Search this space" }), {
    target: { value: "" },
  });
  fireEvent.click(
    within(ui.getByRole("navigation", { name: "Filter items" })).getByRole("button", {
      name: "Favorites",
    }),
  );
  expect(ui.queryByRole("button", { name: "Alpha note" })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Yours" }));
  fireEvent.pointerDown(ui.getByRole("button", { name: "Filter items" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(ui.getByRole("menuitem", { name: "Sort by" }));
  fireEvent.click(ui.getByRole("menuitemradio", { name: "Name A–Z" }));
  expect(ui.getAllByRole("row")[1].textContent).toContain("Alpha note");
  fireEvent.click(ui.getByRole("button", { name: "Grid view" }));
  expect(ui.queryByRole("table")).toBeNull();
  expect(ui.getByRole("button", { name: "Grid view" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(ui.getByRole("button", { name: /^Alpha note/ }));
  expect(ui.getByLabelText("Current route").textContent).toBe("/spaces/one/notes?note=b&view=doc");
});
it("keeps filters available to recover from empty results and disables empty layout switches", () => {
  const ui = renderOverview();
  expect((ui.getByRole("button", { name: "Filter items" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  for (const name of ["Grid view", "List view"])
    expect((ui.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps an empty Suggested collection free of extra guidance", () => {
  const ui = renderOverview();
  fireEvent.click(ui.getByRole("button", { name: "Suggested" }));
  expect(ui.queryByText("Nothing needs your attention")).toBeNull();
  expect(ui.getAllByRole("row")).toHaveLength(1);
  expect(ui.queryByRole("button", { name: "Recent" })).toBeNull();
});
