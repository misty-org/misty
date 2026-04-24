import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacePlannerHeader } from "@/features/spaces/components/SpacePlannerHeader";
import { PlannerPanelSidebar } from "@/features/spaces/components/spacePanel/PlannerPanelSidebar";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

describe("Space subpage navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders Tasks, Agenda, and Roadmap as separate sidebar dropdowns", async () => {
    mockPlannerLists();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlannerPanelSidebar spaceId="space-1" section="agenda" roadmapId="" />
        </MemoryRouter>,
      );
    });

    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Tasks",
      "Agenda",
      "Calendar",
      "Roadmap",
    ]);
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toContain("Agenda");
    expect(container.querySelector('[aria-label="Expand Tasks"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Collapse Agenda"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Expand Roadmap"]')).not.toBeNull();

    const expandTasks = container.querySelector<HTMLButtonElement>('[aria-label="Expand Tasks"]');
    await act(async () => expandTasks?.click());
    expect(container.querySelector('nav[aria-label="Task views"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Collapse Tasks"]')).not.toBeNull();
  });

  it("keeps only Board and List in the Tasks dropdown", async () => {
    mockPlannerLists();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/tasks/list?mine=1&due=week"]}>
          <PlannerPanelSidebar spaceId="space-1" section="tasks" roadmapId="" />
        </MemoryRouter>,
      );
    });

    expect(link("Board")?.getAttribute("href")).toBe(
      "/spaces/space-1/planner/tasks/board?mine=1&due=week",
    );
    expect(link("List")?.getAttribute("href")).toBe(
      "/spaces/space-1/planner/tasks/list?mine=1&due=week",
    );
    expect(link("List")?.getAttribute("aria-current")).toBe("page");
    expect(link("All tasks")).toBeUndefined();
    expect(link("Assigned to me")).toBeUndefined();
    expect(link("Unassigned")).toBeUndefined();
    expect(link("Due this week")).toBeUndefined();
    expect(link("Agenda")).toBeDefined();
    expect(link("Roadmap")).toBeDefined();
  });

  it("keeps Calendar as the Agenda dropdown destination", async () => {
    mockPlannerLists();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/week?date=2026-08-17"]}>
          <PlannerPanelSidebar spaceId="space-1" section="agenda" roadmapId="" />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Agenda destinations"]')).not.toBeNull();
    expect(link("Calendar")?.getAttribute("href")).toBe(
      "/spaces/space-1/planner/agenda/week?date=2026-08-17",
    );
    expect(link("Calendar")?.getAttribute("aria-current")).toBe("page");
    expect(link("Month")).toBeUndefined();
    expect(link("Week")).toBeUndefined();
    expect(link("Day")).toBeUndefined();
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
  });

  it("keeps the Roadmap dropdown flat and labels the collective destination Views", async () => {
    mockPlannerLists();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/goals"]}>
          <PlannerPanelSidebar spaceId="space-1" section="goals" roadmapId="" />
        </MemoryRouter>,
      );
    });

    expect(link("Goals")?.getAttribute("aria-current")).toBe("page");
    expect(link("Milestones")).toBeDefined();
    expect(link("Views")?.getAttribute("href")).toBe("/spaces/space-1/planner/roadmaps");
    expect(container.textContent).not.toContain("Configure");
    expect(container.textContent).not.toContain("Collective");
  });

  it("does not mark Calendar active when its inactive dropdown is expanded", async () => {
    mockPlannerLists();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/tasks/list"]}>
          <PlannerPanelSidebar spaceId="space-1" section="tasks" roadmapId="" />
        </MemoryRouter>,
      );
    });

    const expandAgenda = container.querySelector<HTMLButtonElement>('[aria-label="Expand Agenda"]');
    await act(async () => expandAgenda?.click());

    expect(link("Calendar")).toBeDefined();
    expect(link("Calendar")?.getAttribute("aria-current")).toBeNull();
    expect(link("Calendar")?.classList).not.toContain("misty-active-marker-side");
  });

  it("does not repeat Board and List in the page toolbar", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpacePlannerHeader
            query=""
            activeFilterCount={0}
            sources={[]}
            loading={false}
            canManage={false}
            canManageIntegrations={false}
            calendarImportAvailable={false}
            filters={null}
            onQuery={() => {}}
            onSync={() => {}}
            onImport={() => {}}
            onCreate={() => {}}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Board view"]')).toBeNull();
    expect(container.querySelector('[aria-label="List view"]')).toBeNull();
    expect(container.textContent).not.toContain("Board view");
    expect(container.textContent).not.toContain("List view");
  });

  function link(label: string) {
    return [...container.querySelectorAll("a")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  function mockPlannerLists() {
    vi.spyOn(spacesApi, "roadmaps").mockResolvedValue({ roadmaps: [] });
  }
});
