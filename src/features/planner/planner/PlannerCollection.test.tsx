import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spacesApi } from "@/api/spaces/api";
import { PlannerCollection } from "./PlannerCollection";
vi.mock("@/features/spaces/useSpaceItemCreator", () => ({
  useSpaceItemCreator: () => () => "Alex",
}));
vi.mock("@/api/spaces/api", () => ({
  spacesApi: { tasks: vi.fn(), agenda: vi.fn(), roadmaps: vi.fn(), createCalendarEvent: vi.fn() },
}));
function Route() {
  const route = useLocation();
  return (
    <output data-testid="route">
      {route.pathname}
      {route.search}
    </output>
  );
}
function mount(route = "/spaces/test/planner?section=tasks", canManage = true) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <PlannerCollection spaceId="test" canManage={canManage} />
      <Route />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.mocked(spacesApi.tasks).mockResolvedValue({
    tasks: [
      { id: "task-1", title: "Plan the week", status: "todo", updated_at: "2026-09-30T12:00:00Z" },
    ],
    next_cursor: "",
  } as never);
  vi.mocked(spacesApi.roadmaps).mockResolvedValue({ roadmaps: [] } as never);
  vi.mocked(spacesApi.agenda).mockResolvedValue({ entries: [] } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("opens an existing task in the task editor and preserves the collection root", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Plan the week" }));
  expect(screen.getByTestId("route").textContent).toBe(
    "/spaces/test/planner/tasks/list?task=task-1",
  );
});
it("routes task creation to the existing editor", async () => {
  mount();
  await screen.findByRole("button", { name: "Plan the week" });
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  expect(screen.getByTestId("route").textContent).toBe(
    "/spaces/test/planner/tasks/list?create=task",
  );
});
it("opens the task board from the view controls", async () => {
  mount();
  await screen.findByRole("button", { name: "Plan the week" });
  expect(screen.queryByRole("button", { name: "Task board" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Board view" }));
  expect(screen.getByTestId("route").textContent).toBe("/spaces/test/planner/tasks/board");
});
it.each(["agenda", "roadmaps"])("does not offer the task board in %s", async (section) => {
  vi.mocked(spacesApi.roadmaps).mockResolvedValue({ roadmaps: [] } as never);
  mount(`/spaces/test/planner?section=${section}`);
  expect(screen.queryByRole("button", { name: "Board view" })).toBeNull();
  if (section === "agenda") {
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(screen.getByTestId("route").textContent).toBe("/spaces/test/planner/agenda/month");
  }
});
it("keeps a failed event draft open and shows the failure inside its dialog", async () => {
  vi.mocked(spacesApi.createCalendarEvent).mockRejectedValue(new Error("Connection lost"));
  mount("/spaces/test/planner?section=agenda");
  fireEvent.click(screen.getByRole("button", { name: "New event" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Weekly review" } });
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Connection lost");
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Weekly review");
});
it("does not offer mutation controls without permission", async () => {
  mount(undefined, false);
  await screen.findByRole("button", { name: "Plan the week" });
  expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
});

it("opens agenda entries on their local calendar day", async () => {
  vi.mocked(spacesApi.agenda).mockResolvedValue({
    entries: [
      {
        id: "late",
        title: "Evening review",
        starts_at: new Date(2026, 8, 30, 23, 30).toISOString(),
      },
    ],
  } as never);
  mount("/spaces/test/planner?section=agenda");
  fireEvent.click(await screen.findByRole("button", { name: "Evening review" }));
  expect(screen.getByTestId("route").textContent).toBe(
    "/spaces/test/planner/agenda/day?date=2026-09-30&entry=late",
  );
});

it("keeps server task filters when loading another page and resets them", async () => {
  vi.mocked(spacesApi.tasks).mockImplementation(
    async (_space, filters) =>
      ({
        tasks: [
          {
            id: filters?.cursor ? "next" : "first",
            title: filters?.cursor ? "Next task" : "First task",
            status: filters?.status ?? "todo",
            updated_at: "2026-09-30",
          },
        ],
        next_cursor: filters?.cursor ? "" : "next-page",
      }) as never,
  );
  mount();
  await screen.findByRole("button", { name: "First task" });
  const open = () =>
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter tasks" }), {
      button: 0,
      ctrlKey: false,
    });
  open();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Completed" }));
  await waitFor(() =>
    expect(spacesApi.tasks).toHaveBeenLastCalledWith(
      "test",
      expect.objectContaining({ status: "done" }),
    ),
  );
  open();
  fireEvent.click(screen.getByRole("menuitem", { name: "Priority" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
  await waitFor(() =>
    expect(spacesApi.tasks).toHaveBeenLastCalledWith(
      "test",
      expect.objectContaining({ status: "done", priority: "high" }),
    ),
  );
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Load more" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("button", { name: "Next task" });
  expect(spacesApi.tasks).toHaveBeenLastCalledWith(
    "test",
    expect.objectContaining({ status: "done", priority: "high", cursor: "next-page" }),
  );
  open();
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset filters" }));
  await waitFor(() =>
    expect(spacesApi.tasks).toHaveBeenLastCalledWith(
      "test",
      expect.objectContaining({ status: undefined, priority: undefined, sort: "rank" }),
    ),
  );
});

it("combines tasks, upcoming events and roadmaps in All, ignoring task-only filters", async () => {
  vi.mocked(spacesApi.agenda).mockResolvedValue({
    entries: [{ id: "task-1", title: "Team review", starts_at: "2026-10-02T12:00:00Z" }],
  } as never);
  vi.mocked(spacesApi.roadmaps).mockResolvedValue({
    roadmaps: [{ id: "task-1", name: "Autumn roadmap", updated_at: "2026-10-01T12:00:00Z" }],
  } as never);
  mount("/spaces/test/planner");
  await screen.findByRole("button", { name: "Plan the week" });
  expect(screen.getByRole("button", { name: "All", pressed: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Team review" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Autumn roadmap" }));
  expect(screen.getByTestId("route").textContent).toBe("/spaces/test/planner/roadmaps/task-1");
});
