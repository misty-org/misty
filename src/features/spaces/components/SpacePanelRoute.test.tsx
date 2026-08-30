import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSpacePanelRoute } from "../components/spacePanel/spacePanelRoute";
import {
  activeSpacesTab,
  normalizeSpacesTabRoute,
  spacesTabsSessionKey,
  useSpacesTabsStore,
} from "../store/useSpacesTabsStore";

function RouteProbe() {
  const route = useSpacePanelRoute();
  return <output>{JSON.stringify(route)}</output>;
}

describe("Space routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useSpacesTabsStore.setState({ sessions: {} });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    ["/spaces/space-1", "home"],
    ["/spaces/space-1/home", "home"],
    ["/spaces/space-1/not-a-section", "notes"],
  ])("resolves %s to %s", async (entry, section) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <RouteProbe />
        </MemoryRouter>,
      );
    });
    const route = JSON.parse(container.textContent ?? "{}") as { section?: string };
    expect(route.section).toBe(section);
  });

  it("preserves an existing tab's exact section, query, and hash", () => {
    const route = "/spaces/space-1/planner/tasks/list?mine=1#today";
    useSpacesTabsStore.getState().ensureSession("account-1", "space-1", route);
    const active = activeSpacesTab(
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-1")],
    );
    expect(active?.kind).toBe("space");
    expect(active?.kind === "space" ? active.route : "").toBe(route);
  });

  it.each([
    ["/spaces/space-1/planner/tasks/list", "tasks", "list", "month", ""],
    ["/spaces/space-1/planner/agenda/week", "agenda", "board", "week", ""],
    ["/spaces/space-1/planner/agenda/day", "agenda", "board", "day", ""],
    ["/spaces/space-1/planner/goals", "goals", "board", "month", ""],
    ["/spaces/space-1/planner/milestones", "milestones", "board", "month", ""],
    ["/spaces/space-1/planner/roadmaps/map-1", "roadmaps", "board", "month", "map-1"],
    ["/spaces/space-1/planner/calendar", "agenda", "board", "month", ""],
  ])("parses Planner route %s", async (entry, plannerSection, taskView, agendaView, roadmapId) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <RouteProbe />
        </MemoryRouter>,
      );
    });
    const route = JSON.parse(container.textContent ?? "{}") as Record<string, string>;
    expect(route).toMatchObject({ plannerSection, taskView, agendaView, roadmapId });
  });

  it("normalizes legacy Planner routes without dropping query or hash", () => {
    expect(normalizeSpacesTabRoute("/spaces/space-1/planner/list?mine=1#today")).toBe(
      "/spaces/space-1/planner/tasks/list?mine=1#today",
    );
    expect(normalizeSpacesTabRoute("/spaces/space-1/planner/calendar")).toBe(
      "/spaces/space-1/planner/agenda/month",
    );
    expect(normalizeSpacesTabRoute("/spaces/space-1/home")).toBe("/spaces/space-1/home");
  });

  it.each(["misty", "instagram", "messenger", "x", "discord"] as const)(
    "parses the %s Social provider page",
    async (socialProvider) => {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={[`/spaces/space-1/social/${socialProvider}`]}>
            <RouteProbe />
          </MemoryRouter>,
        );
      });
      const route = JSON.parse(container.textContent ?? "{}") as Record<string, string>;
      expect(route).toMatchObject({ section: "social", socialProvider });
    },
  );
});
