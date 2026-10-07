import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dockTreeViews, useWorkspaceStore } from "@/features/workspace";
import { WorkspaceCanvas } from "./WorkspaceCanvas";

// Open tabs stay mounted, so a change that concerns one tab, or only the app
// route, must not re-render every other tab's page. Pages here are stand-ins
// that count their renders.
const renders = new Map<string, number>();
vi.mock("./WorkspaceSurface", () => ({
  WorkspaceSurface: ({ tab }: { tab: { id: string } }) => {
    renders.set(tab.id, (renders.get(tab.id) ?? 0) + 1);
    return <div data-tab={tab.id} />;
  },
  EmptyWorkspacePane: () => null,
}));
vi.mock("./WorkspaceTabStrip", () => ({ WorkspaceTabStrip: () => <nav /> }));

let go: (to: string) => void = () => undefined;
function RouteDriver() {
  const navigate = useNavigate();
  go = (to) => void navigate(to);
  return null;
}

beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  useWorkspaceStore.getState().reset();
  const initial = dockTreeViews(useWorkspaceStore.getState().layout.root);
  for (let i = 0; i < 8; i += 1)
    useWorkspaceStore.getState().openBrowserView({ url: `https://site${i}.example/` });
  for (const tab of initial) useWorkspaceStore.getState().closeView(tab.id);
  renders.clear();
});
afterEach(cleanup);

const total = () => [...renders.values()].reduce((sum, count) => sum + count, 0);

it("re-renders only the page whose tab changed, and none for a route change", () => {
  render(
    <MemoryRouter initialEntries={["/browser"]}>
      <RouteDriver />
      <WorkspaceCanvas />
    </MemoryRouter>,
  );
  const views = dockTreeViews(useWorkspaceStore.getState().layout.root);
  expect(renders.size).toBe(8);

  renders.clear();
  act(() => useWorkspaceStore.getState().updateBrowserView(views[0].id, { title: "New title" }));
  expect([...renders.keys()]).toEqual([views[0].id]);
  expect(total()).toBe(1);

  renders.clear();
  act(() => go("/browser?changed=1"));
  expect(total()).toBe(0);
});
