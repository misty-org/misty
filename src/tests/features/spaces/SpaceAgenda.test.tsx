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

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
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

import { SpaceAgenda } from "@/features/spaces/SpaceAgenda";

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

  it.each(["month", "week", "list"] as const)("renders the %s presentation", async (view) => {
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
    expect(container.textContent).toContain("Launch dependency risk");
    expect(container.querySelector(`main[aria-label="${view} agenda"]`)).not.toBeNull();
    const activeView = `${view[0].toUpperCase()}${view.slice(1)} view`;
    expect(
      container.querySelector(`[aria-label="${activeView}"]`)?.getAttribute("data-state"),
    ).toBe("on");
  });

  it("applies account-and-Space visibility preferences", async () => {
    window.localStorage.setItem(
      "misty:agenda-visibility:account-1:space-1",
      JSON.stringify({ tasks: false, roadmap: true, hiddenSources: [] }),
    );
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/list?date=2026-08-04"]}>
          <SpaceAgenda spaceId="space-1" view="list" canManage canManageIntegrations />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Ship beta");
    expect(container.textContent).toContain("Launch goal");
    expect(container.textContent).toContain("Launch dependency risk");
  });
});
