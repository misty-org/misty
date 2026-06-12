import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  agenda,
  archiveTask,
  calendarSources,
  connections,
  deleteCalendarEvent,
  googleCalendars,
  integrations,
  syncCalendarTasks,
  tasks,
  updateCalendarEvent,
  updateTask,
} = vi.hoisted(() => ({
  agenda: vi.fn(),
  archiveTask: vi.fn(),
  calendarSources: vi.fn(),
  connections: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  googleCalendars: vi.fn(),
  integrations: vi.fn(),
  syncCalendarTasks: vi.fn(),
  tasks: vi.fn(),
  updateCalendarEvent: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("@/api/connections", () => ({
  connectionsApi: {
    list: connections,
    authorize: vi.fn(),
  },
}));
vi.mock("@/api/spaces/api", () => ({
  spacesApi: {
    agenda,
    calendarSources,
    integrations,
    syncCalendarTasks,
    tasks,
    updateCalendarEvent,
    deleteCalendarEvent,
    updateTask,
    archiveTask,
    googleCalendars,
    publishGoogleCalendar: vi.fn(),
    disableCalendarSource: vi.fn(),
  },
}));

import { SpaceAgenda } from "@/features/spaces/planner/SpaceAgenda";

describe("SpaceAgenda", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    calendarSources.mockResolvedValue({
      sources: [
        {
          id: "source-1",
          display_name: "Team calendar",
          status: "active",
          provider: "google",
        },
      ],
    });
    integrations.mockResolvedValue({ integrations: [] });
    connections.mockResolvedValue({ connections: [] });
    googleCalendars.mockResolvedValue({ calendars: [] });
    syncCalendarTasks.mockResolvedValue({ tasks: [], sources: [], synced_at: "2026-08-01" });
    updateCalendarEvent.mockResolvedValue({});
    deleteCalendarEvent.mockResolvedValue(undefined);
    tasks.mockResolvedValue({ tasks: [], status_totals: {} });
    agenda.mockResolvedValue({
      entries: [
        {
          id: "task:1",
          kind: "task",
          task_id: "task-1",
          title: "Ship beta",
          starts_at: "2026-08-04T17:00:00Z",
          ends_at: "2026-08-04T17:30:00Z",
          all_day: false,
          timezone: "America/Los_Angeles",
        },
        {
          id: "goal:1",
          kind: "goal",
          roadmap_id: "map-1",
          goal_id: "goal-1",
          title: "Launch goal",
          starts_at: "2026-08-05T00:00:00Z",
          ends_at: "2026-08-06T00:00:00Z",
          all_day: true,
          timezone: "UTC",
        },
        {
          id: "roadmap_node:risk-1",
          kind: "roadmap_node",
          roadmap_id: "map-1",
          roadmap_node_id: "risk-1",
          roadmap_node_kind: "risk",
          title: "Launch dependency risk",
          starts_at: "2026-08-06T00:00:00Z",
          ends_at: "2026-08-07T00:00:00Z",
          all_day: true,
          timezone: "UTC",
        },
      ],
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    window.localStorage.clear();
    container.remove();
    vi.restoreAllMocks();
  });

  it.each(["month", "week", "day"] as const)("renders the %s presentation", async (view) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/spaces/space-1/planner/agenda/${view}?date=2026-08-04`]}>
          <SpaceAgenda spaceId="space-1" view={view} canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Ship beta");
    if (view === "day") {
      expect(container.textContent).not.toContain("Launch goal");
      expect(container.textContent).not.toContain("Launch dependency risk");
    } else {
      expect(container.textContent).toContain("Launch goal");
      expect(container.textContent).toContain("Launch dependency risk");
    }
    expect(container.querySelector(`main[aria-label="${view} agenda"]`)).not.toBeNull();
    expect(container.querySelector('[aria-label="Agenda view"]')).toBeNull();
  });

  it("applies account-and-Space visibility preferences", async () => {
    window.localStorage.setItem(
      "misty:agenda-visibility:account-1:space-1",
      JSON.stringify({ tasks: false, roadmap: true, hiddenSources: [] }),
    );
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/week?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="week" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Ship beta");
    expect(container.textContent).toContain("Launch goal");
    expect(container.textContent).toContain("Launch dependency risk");
  });

  it("keeps the month calendar visible when there are no entries", async () => {
    agenda.mockResolvedValue({ entries: [] });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="month" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Your agenda is clear");
    expect(container.querySelectorAll('main[aria-label="month agenda"] section')).toHaveLength(42);
  });

  it("restores Google Calendar connection controls", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="month" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Calendars");
    expect(container.querySelector('[aria-label="Google Calendar"]')).not.toBeNull();
    expect(calendarSources).toHaveBeenCalledWith("space-1");
    expect(integrations).toHaveBeenCalledWith("space-1");
    expect(connections).toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Google Calendar"]')?.click();
    });
    expect(document.body.querySelector('input[aria-label="Search calendars"]')).not.toBeNull();
    expect(document.body.querySelector('[data-social-provider-icon="misty"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Add another account");
    expect(document.body.textContent).toContain("Not connected");
    expect(document.body.textContent).not.toContain("No Google account connected");
  });

  it("searches connected Google calendars in the calendar manager", async () => {
    integrations.mockResolvedValue({
      integrations: [
        {
          id: "integration-1",
          provider: "google",
          display_name: "mtccool668@gmail.com",
          status: "active",
        },
      ],
    });
    calendarSources.mockResolvedValue({
      sources: [
        {
          id: "source-primary",
          integration_id: "integration-1",
          external_calendar_id: "primary",
          display_name: "mtccool668@gmail.com",
          status: "active",
          provider: "google",
        },
      ],
    });
    googleCalendars.mockResolvedValue({
      calendars: [
        {
          id: "primary",
          summary: "mtccool668@gmail.com",
          timeZone: "America/Los_Angeles",
          primary: true,
          accessRole: "owner",
        },
        {
          id: "holidays",
          summary: "Holidays in United States",
          timeZone: "America/Los_Angeles",
          accessRole: "reader",
        },
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="month" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Google Calendar"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Connected");
    expect(document.body.textContent).toContain("Manage account");
    expect(document.body.textContent).toContain("Choose calendars to share with this Space.");
    expect(document.body.textContent).toContain("mtccool668@gmail.com");
    expect(document.body.textContent).toContain("Holidays in United States");

    const search = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Search calendars"]',
    );
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "holiday",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain("Primary calendar");
    expect(document.body.textContent).toContain("Holidays in United States");
  });

  it("uses the shared top-bar layout and zooms the timeline precision", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/week?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="week" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("header button")?.textContent?.trim()).toBe("New");
    expect(container.querySelector('[aria-label="Go to today"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Calendar view"]')?.textContent).toContain("Week");
    expect(container.querySelector('[aria-label="Calendar time interval"]')?.textContent).toContain(
      "30 min",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "New",
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("New task");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Zoom in calendar"]')?.click();
    });
    expect(container.querySelector('[aria-label="Calendar time interval"]')?.textContent).toContain(
      "15 min",
    );
  });

  it("keeps the current-time marker in the gutter and behind overlapping events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T17:15:00.000Z"));
    agenda.mockResolvedValue({
      entries: [
        {
          id: "event:overlapping-now",
          kind: "event",
          source_id: "source-1",
          external_event_id: "overlapping-now",
          title: "Current event",
          starts_at: "2026-08-04T17:00:00.000Z",
          ends_at: "2026-08-04T18:00:00.000Z",
          all_day: false,
          timezone: "America/Los_Angeles",
          status: "confirmed",
        },
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/day?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="day" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const label = container.querySelector<HTMLElement>("[data-agenda-current-time-label]");
    const line = container.querySelector<HTMLElement>("[data-agenda-current-time-line]");
    const event = container.querySelector<HTMLElement>("[data-agenda-timed-event]");

    expect(label?.className).toContain("w-[72px]");
    expect(line?.className).toContain("z-10");
    expect(line?.className).toContain("pointer-events-none");
    expect(event?.className).toContain("z-20");
  });

  it("keeps time zoom out of Month view", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="month" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="Calendar time interval"]')).toBeNull();
    expect(container.querySelector('[aria-label="month agenda"]')).not.toBeNull();
  });

  it("opens task details inside Agenda without changing pages", async () => {
    tasks.mockResolvedValue({
      tasks: [
        {
          id: "task-1",
          space_id: "space-1",
          task_number: 1,
          task_key: "MST-1",
          title: "Ship beta",
          notes: "Finish the release checklist.",
          status: "todo",
          priority: "medium",
          rank: 1024,
          due_timezone: "America/Los_Angeles",
          source_refs: [],
          version: 1,
          created_at: "2026-08-01T12:00:00Z",
          updated_at: "2026-08-01T12:00:00Z",
        },
      ],
      status_totals: { todo: 1 },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <LocationProbe />
          <SpaceAgenda spaceId="space-1" view="month" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const taskChip = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Ship beta"),
    );
    const taskRequestsBeforeClick = tasks.mock.calls.length;
    await act(async () => {
      taskChip?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="agenda-location"]')?.textContent).toBe(
      "/spaces/space-1/planner/agenda/month?date=2026-08-04",
    );
    const title = document.querySelector<HTMLInputElement>("#space-task-title");
    expect(title?.value).toBe("Ship beta");
    expect(title?.className).toContain("border-charcoal-border");
    expect(tasks).toHaveBeenCalledTimes(taskRequestsBeforeClick);
    expect(document.querySelector('[data-slot="dialog-header"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Attached context");
    expect(document.body.textContent).not.toContain("Activity & Run History");
  });

  it("opens calendar event details in a centered popup", async () => {
    agenda.mockResolvedValue({
      entries: [
        {
          id: "event:calendar-event-1",
          kind: "event",
          source_id: "source-1",
          external_event_id: "google-event-1",
          title: "Product review",
          description: "Review the launch plan.",
          location: "Studio",
          starts_at: "2026-08-04T17:00:00Z",
          ends_at: "2026-08-04T18:00:00Z",
          all_day: false,
          timezone: "America/Los_Angeles",
          status: "confirmed",
        },
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="month" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const eventChip = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Product review"),
    );
    await act(async () => {
      eventChip?.click();
    });

    const dialog = document.querySelector('[data-slot="dialog-content"]');
    expect(dialog?.textContent).toContain("Product review");
    expect(dialog?.textContent).toContain("Review the launch plan.");
    expect(dialog?.textContent).toContain("read-only in Misty");
    expect(dialog?.textContent).not.toContain("Save changes");
    expect(dialog?.textContent).not.toContain("Delete event");
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("edits and deletes native Misty events from the popup", async () => {
    agenda.mockResolvedValue({
      entries: [
        {
          id: "event:native-event-1",
          kind: "event",
          source_id: "misty",
          title: "Product review",
          description: "Review the launch plan.",
          location: "Studio",
          starts_at: "2026-08-04T17:00:00Z",
          ends_at: "2026-08-04T18:00:00Z",
          all_day: false,
          timezone: "America/Los_Angeles",
          status: "confirmed",
          version: 3,
        },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="month" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Product review"))
        ?.click();
    });

    const title = document.body.querySelector<HTMLInputElement>('[aria-label="Event title"]');
    expect(title?.value).toBe("Product review");
    expect(document.body.textContent).toContain("Delete event");
    expect(document.body.textContent).toContain("Save changes");

    await act(async () => {
      if (!title) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        title,
        "Launch review",
      );
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Save changes"))
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCalendarEvent).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({ id: "native-event-1", title: "Launch review", version: 3 }),
    );

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Product review"))
        ?.click();
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Delete event"))
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.confirm).toHaveBeenCalledWith("Delete “Product review”?");
    expect(deleteCalendarEvent).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({ id: "native-event-1", version: 3 }),
    );
  });
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="agenda-location">
      {location.pathname}
      {location.search}
    </output>
  );
}
