import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { formatLocalTime } from "./scheduleFormat";
import { ScheduledCollection } from "./ScheduledCollection";
import { useScheduledTasksStore } from "./useScheduledTasksStore";
import type { ScheduledTask } from "@/api/scheduled/api";
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./ScheduledTaskEditor", () => ({
  ScheduledTaskEditor: ({
    task,
    onSaved,
  }: {
    task?: ScheduledTask;
    onSaved: (task: ScheduledTask) => void;
  }) => (
    <button onClick={() => onSaved({ ...task, id: task?.id ?? "new" } as ScheduledTask)}>
      Save schedule
    </button>
  ),
}));
const task = {
  id: "weekly",
  title: "Weekly planning",
  prompt: "Plan the week",
  enabled: true,
  cadence: "weekly",
  weekday: 1,
  month_day: 1,
  local_time: "09:00",
  timezone: "UTC",
  state: "idle",
  run_count: 0,
  created_at: "2026-09-30",
  updated_at: "2026-09-30",
} as ScheduledTask;
function Route() {
  const route = useLocation();
  return (
    <output data-testid="route">
      {route.pathname}
      {route.search}
    </output>
  );
}
function mount(creating = false, query = "") {
  render(
    <MemoryRouter initialEntries={["/agents?view=scheduled"]}>
      <ScheduledCollection
        query={query}
        view="list"
        creating={creating}
        onCreatingChange={vi.fn()}
      />
      <Route />
    </MemoryRouter>,
  );
}
beforeEach(() =>
  useScheduledTasksStore.setState({
    accountId: "owner",
    tasks: [task],
    state: "ready",
    error: null,
    load: async () => {},
  }),
);
afterEach(cleanup);
it("opens the existing schedule within Agents", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Weekly planning" }));
  expect(screen.getByTestId("route").textContent).toBe("/agents?view=scheduled&task=weekly");
});
it("opens the persisted task after creating a schedule", () => {
  mount(true);
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  expect(screen.getByTestId("route").textContent).toBe("/agents?view=scheduled&task=new");
});
it("searches titles while retaining the empty table headers", () => {
  mount(false, "unmatched");
  expect(screen.queryByRole("button", { name: "Weekly planning" })).toBeNull();
  expect(screen.getAllByRole("row")).toHaveLength(1);
  expect(screen.getByRole("columnheader", { name: "Frequency" })).toBeTruthy();
});

it.each([
  ["daily", "Daily"],
  ["weekdays", "Weekdays"],
  ["weekly", "Mondays"],
  ["monthly", "Monthly on day 1"],
  ["once", "Once on Oct 5"],
] as const)(
  "separates %s frequency and clock time, including paused schedules",
  (cadence, frequency) => {
    useScheduledTasksStore.setState({
      tasks: [{ ...task, cadence, run_on: "2026-10-05", enabled: false }],
    });
    mount();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Name",
      "Frequency",
      "Time",
      "Status",
      "Time zone",
      "Next run",
      "Last run",
      "Runs",
      "Last activity",
      "Actions",
    ]);
    const cells = screen.getAllByRole("cell");
    expect(cells[3].textContent).toBe("Paused");
    expect(cells[1].textContent).toBe(frequency);
    expect(cells[2].textContent).toBe(formatLocalTime("09:00"));
    expect(cells[4].textContent).toBe("UTC");
  },
);

it("sorts Time by clock value instead of formatted AM/PM text", () => {
  useScheduledTasksStore.setState({
    tasks: [
      { ...task, id: "late", title: "Evening", local_time: "18:00" },
      { ...task, id: "early", title: "Morning", local_time: "09:00" },
    ],
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Time" }));
  expect(screen.getAllByRole("row")[1].textContent).toContain("Morning");
  fireEvent.click(screen.getByRole("button", { name: "Time" }));
  expect(screen.getAllByRole("row")[1].textContent).toContain("Evening");
});
