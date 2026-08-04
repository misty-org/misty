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
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Tasks", "Agenda", "Roadmap"]);
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toContain("Agenda");
    expect(container.querySelector('[aria-label="Expand Tasks"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Collapse Agenda"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Expand Roadmap"]')).not.toBeNull();

    const expandTasks = container.querySelector<HTMLButtonElement>('[aria-label="Expand Tasks"]');
    await act(async () => expandTasks?.click());
    expect(container.querySelector('nav[aria-label="Task shortcuts"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Collapse Tasks"]')).not.toBeNull();
  });

  it("keeps task shortcuts in the sidebar but moves Board and List into the toolbar", async () => {
    mockPlannerLists();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/tasks/list?mine=1&due=week"]}>
          <PlannerPanelSidebar spaceId="space-1" section="tasks" roadmapId="" />
        </MemoryRouter>,
      );
    });

    expect(link("Board")).toBeUndefined();
    expect(link("List")).toBeUndefined();
    expect(link("Assigned to me")?.getAttribute("href")).toBe(
      "/spaces/space-1/planner/tasks/list?mine=1",
    );
    expect(link("Agenda")).toBeDefined();
    expect(link("Roadmap")).toBeDefined();
  });

  it("keeps calendar visibility in the sidebar without Agenda view modes", async () => {
    mockPlannerLists();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/agenda/week?date=2026-08-17"]}>
          <PlannerPanelSidebar spaceId="space-1" section="agenda" roadmapId="" />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Visible calendars");
    expect(link("Month")).toBeUndefined();
    expect(link("Week")).toBeUndefined();
    expect(link("List")).toBeUndefined();
  });

  it("switches task presentation from the page toolbar", async () => {
    const onViewChange = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpacePlannerHeader
            view="board"
            query=""
            activeFilterCount={0}
            sources={[]}
            loading={false}
            canManage={false}
            canManageIntegrations={false}
            calendarImportAvailable={false}
            filters={null}
            onViewChange={onViewChange}
            onQuery={() => {}}
            onSync={() => {}}
            onImport={() => {}}
            onCreate={() => {}}
          />
        </MemoryRouter>,
      );
    });

    const listView = container.querySelector<HTMLButtonElement>('[aria-label="List view"]');
    await act(async () => listView?.click());
    expect(onViewChange).toHaveBeenCalledWith("list");
  });

  function link(label: string) {
    return [...container.querySelectorAll("a")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  function mockPlannerLists() {
    vi.spyOn(spacesApi, "calendarSources").mockResolvedValue({ sources: [] });
    vi.spyOn(spacesApi, "roadmaps").mockResolvedValue({ roadmaps: [] });
  }
});
