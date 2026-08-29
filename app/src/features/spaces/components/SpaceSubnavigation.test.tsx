import { SpacePlannerHeader } from "@/features/spaces/planner/components/SpacePlannerHeader";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerPanelSidebar } from "../components/spacePanel/PlannerPanelSidebar";

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

  it("renders Tasks, Agenda, and Roadmaps as direct category links", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlannerPanelSidebar spaceId="space-1" section="agenda" roadmapId="" />
        </MemoryRouter>,
      );
    });

    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Tasks", "Agenda", "Roadmaps"]);
    expect(link("Agenda")?.getAttribute("aria-current")).toBe("page");
    expect(link("Tasks")?.getAttribute("href")).toBe("/spaces/space-1/planner/tasks/board");
    expect(link("Agenda")?.getAttribute("href")).toBe("/spaces/space-1/planner/agenda/month");
    expect(link("Roadmaps")?.getAttribute("href")).toBe("/spaces/space-1/planner/roadmaps");
  });

  it("highlights Roadmaps category link when a roadmap or goal is active", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/roadmaps/rm-1"]}>
          <PlannerPanelSidebar spaceId="space-1" section="roadmaps" roadmapId="rm-1" />
        </MemoryRouter>,
      );
    });

    expect(link("Roadmaps")?.getAttribute("aria-current")).toBe("page");
  });

  it("renders Board and List view switcher in the Tasks header toolbar", async () => {
    const onViewChange = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpacePlannerHeader
            view="board"
            onViewChange={onViewChange}
            query=""
            activeFilterCount={0}
            loading={false}
            canManage={false}
            filters={null}
            onQuery={() => {}}
            onSync={() => {}}
            onCreate={() => {}}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Board view"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="List view"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Board view"]')?.getAttribute("data-state")).toBe(
      "on",
    );

    const listViewButton = container.querySelector<HTMLButtonElement>('[aria-label="List view"]');
    await act(async () => listViewButton?.click());
    expect(onViewChange).toHaveBeenCalledWith("list");
  });

  function link(label: string) {
    return [...container.querySelectorAll("a")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }
});
