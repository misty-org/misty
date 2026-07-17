import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceViewRouteScope } from "@/features/workspace/WorkspaceViewRouteScope";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { allLayoutViews, activeLayoutView } from "@/features/workspace/layoutTabs";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { HomeRecent } from "./HomeRecent";
import { describeTab } from "./useContinueItems";

beforeEach(() => useWorkspaceStore.getState().reset());
afterEach(cleanup);
it.each([false, true])(
  "selects a %s closed tab without rewriting Home's route or history",
  (closed) => {
    const store = useWorkspaceStore.getState();
    const website = store.openBrowserView({ url: "https://example.com" });
    if (closed) store.closeView(website.id);
    const home = store.addSurface(workspaceSurfaceFromRoute("/home")!);
    const before = useWorkspaceStore.getState().layout.root;
    const item = { tab: website, windowTitle: "", ...describeTab(website) };
    const ui = render(
      <MemoryRouter initialEntries={["/home"]}>
        <WorkspaceViewRouteScope tab={home}>
          <HomeRecent items={closed ? [] : [item]} />
        </WorkspaceViewRouteScope>
      </MemoryRouter>,
    );
    fireEvent.click(ui.getByRole("button", { name: /example.com/ }));
    expect(activeLayoutView(useWorkspaceStore.getState().layout)?.id).toBe(website.id);
    const views = allLayoutViews(useWorkspaceStore.getState().layout);
    expect(views.filter((tab) => tab.id === website.id)).toHaveLength(1);
    expect(views.find((tab) => tab.id === home.id)?.route).toBe("/home");
    const savedHome = useWorkspaceStore
      .getState()
      .layout.tabs!.find((tab) => tab.root.id === before.id)!;
    expect(savedHome.root).toEqual(before);
  },
);
