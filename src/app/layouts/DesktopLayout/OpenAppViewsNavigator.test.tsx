import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkspaceStore, type WorkspaceLayout, type WorkspaceTab } from "@/features/workspace";
import { activeLayoutView } from "@/features/workspace/layoutTabs";
import { OpenAppViewsNavigator } from "./OpenAppViewsNavigator";
import { browserTab } from "./GlobalNavigator.testFixtures";

beforeEach(() => useWorkspaceStore.getState().reset());
afterEach(cleanup);
function view(id: string, appId: "code" | "terminal"): WorkspaceTab {
  return {
    ...browserTab,
    id,
    title: id,
    groupKey: `app:${appId}`,
    route: `/apps/${appId}`,
    instanceKey: id,
  };
}
function layout(views: WorkspaceTab[]): WorkspaceLayout {
  return {
    focusedPaneId: "pane",
    root: { type: "leaf", id: "pane", tabs: views, activeTabId: views[0]?.id ?? null },
  };
}
function seed(views: WorkspaceTab[]) {
  useWorkspaceStore.setState({ layout: layout(views), virtualWindowsByScope: {} });
}
it.each(["code", "terminal"] as const)("selects the exact %s view when routes match", (appId) => {
  seed([view("First", appId), view("Second", appId)]);
  const ui = render(
    <MemoryRouter>
      <OpenAppViewsNavigator appId={appId} />
    </MemoryRouter>,
  );
  fireEvent.click(ui.getByRole("button", { name: "Second" }));
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.id).toBe("Second");
  expect(ui.getByRole("button", { name: "Second" }).getAttribute("aria-current")).toBe("page");
});
it("updates live when views open and close", () => {
  seed([]);
  const ui = render(
    <MemoryRouter>
      <OpenAppViewsNavigator appId="terminal" />
    </MemoryRouter>,
  );
  expect(ui.getByText("No open sessions.")).toBeTruthy();
  act(() => seed([view("Build session", "terminal"), view("Project", "code")]));
  expect(ui.getByRole("button", { name: "Build session" })).toBeTruthy();
  expect(ui.queryByRole("button", { name: "Project" })).toBeNull();
  act(() => seed([]));
  expect(ui.queryByRole("button", { name: "Build session" })).toBeNull();
});
it("focuses an open workspace in another window without including another Space", () => {
  const state = useWorkspaceStore.getState();
  const first = {
    id: "first",
    title: "First",
    layout: layout([view("Local", "code")]),
    createdAt: 1,
    lastFocusedAt: 1,
  };
  const second = { ...first, id: "second", layout: layout([view("Remote", "code")]) };
  useWorkspaceStore.setState({
    layout: first.layout,
    activeVirtualWindowId: first.id,
    virtualWindowsByScope: {
      [state.activeScopeKey]: [first, second],
      "space:other": [{ ...first, id: "private", layout: layout([view("Other Space", "code")]) }],
    },
  });
  const ui = render(
    <MemoryRouter>
      <OpenAppViewsNavigator appId="code" />
    </MemoryRouter>,
  );
  expect(ui.queryByRole("button", { name: "Other Space" })).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Remote" }));
  expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe("second");
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.id).toBe("Remote");
});
