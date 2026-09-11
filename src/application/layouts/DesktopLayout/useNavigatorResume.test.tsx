import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { allLayoutViews, layoutTabs } from "@/features/workspace/layoutTabs";
import { useNavigatorResume } from "./useNavigatorResume";
import { setAppUnsaved } from "@/features/apps/appUpdateSafety";
afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().reset();
});
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const state = () => useWorkspaceStore.getState();
function navigator(route: string) {
  return renderHook(
    () => ({
      open: useNavigatorResume({ accountId: "a", key: "app", fallbackRoute: route }),
      location: useLocation(),
    }),
    { wrapper },
  );
}
it("replaces the focused pane without jumping to another app instance", () => {
  const existing = state().addSurface(workspaceSurfaceFromRoute("/apps/planner?view=agenda")!);
  const home = state().newLayoutTab();
  const id = state().layout.activeLayoutTabId,
    pane = state().layout.focusedPaneId;
  const { result } = navigator("/apps/planner");
  act(() => result.current.open());
  expect(state().layout.activeLayoutTabId).toBe(id);
  expect(state().layout.focusedPaneId).toBe(pane);
  expect(allLayoutViews(state().layout).find((view) => view.id === existing.id)?.route).toBe(
    existing.route,
  );
  expect(layoutTabs(state().layout)).toHaveLength(3);
  expect(allLayoutViews(state().layout).some((view) => view.id === home.id)).toBe(false);
  expect(state().canNavigatePane(-1)).toBe(false);
});
it("targets the requested Space and its default route", () => {
  const { result } = navigator("/apps/planner?space=one");
  act(() => result.current.open());
  expect(state().activeScopeKey).toBe("space:one");
  expect(result.current.location.search).toBe("?space=one");
});
it("preserves the current pane when unsaved work blocks navigation", () => {
  const view = state().openSurface(workspaceSurfaceFromRoute("/apps/code")!);
  setAppUnsaved(view.id, true);
  try {
    const { result } = navigator("/discover");
    act(() => result.current.open());
    expect(result.current.location.pathname).toBe("/apps/code");
    expect(allLayoutViews(state().layout).map((view) => view.route)).toEqual(["/apps/code"]);
  } finally {
    setAppUnsaved(view.id, false);
  }
});
