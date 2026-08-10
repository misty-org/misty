import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { agenda, calendarSources, integrations, syncCalendarTasks } = vi.hoisted(() => ({
  agenda: vi.fn(),
  calendarSources: vi.fn(),
  integrations: vi.fn(),
  syncCalendarTasks: vi.fn(),
}));

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("@/services/spaces/api", () => ({
  spacesApi: {
    agenda,
    calendarSources,
    integrations,
    syncCalendarTasks,
    googleCalendars: vi.fn().mockResolvedValue({ calendars: [] }),
    publishGoogleCalendar: vi.fn(),
    disableCalendarSource: vi.fn(),
  },
}));

import { SpaceAgenda } from "@/features/space-planner/SpaceAgenda";

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
    syncCalendarTasks.mockResolvedValue({ tasks: [], sources: [], synced_at: "2026-08-01" });
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
    window.localStorage.clear();
    container.remove();
  });

  it.each(["month", "week", "day"] as const)("renders the %s presentation", async (view) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/spaces/space-1/planner/agenda/${view}?date=2026-08-04`]}>
          <SpaceAgenda spaceId="space-1" view={view} canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Ship beta");
    expect(container.textContent).toContain("Launch goal");
    if (view === "day") expect(container.textContent).not.toContain("Launch dependency risk");
    else expect(container.textContent).toContain("Launch dependency risk");
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
          <SpaceAgenda spaceId="space-1" view="week" canManage canManageIntegrations />
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
          <SpaceAgenda spaceId="space-1" view="month" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Your agenda is clear");
    expect(container.querySelectorAll('main[aria-label="month agenda"] section')).toHaveLength(42);
  });

  it("moves calendar visibility controls into the Calendars drawer", async () => {
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
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Calendars"))
        ?.click();
    });

    expect(document.body.textContent).toContain("Visible calendars");
    expect(document.querySelector('[aria-label="Misty"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Google Calendar"]')).not.toBeNull();
  });

  it("uses the shared top-bar layout and zooms the timeline precision", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/week?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="week" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("h1")?.textContent).toBe("Agenda");
    expect(container.querySelector('[aria-label="Go to today"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Calendar view"]')?.textContent).toContain("Week");
    expect(container.querySelector('[aria-label="Calendar time interval"]')?.textContent).toContain(
      "30 min",
    );
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("New event"),
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

  it("keeps time zoom out of Month view", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/month?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="month" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="Calendar time interval"]')).toBeNull();
    expect(container.querySelector('[aria-label="month agenda"]')).not.toBeNull();
  });
});
