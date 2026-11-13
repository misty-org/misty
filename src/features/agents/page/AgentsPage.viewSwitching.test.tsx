import { conversation, fixture } from "./AgentsPage.testFixtures";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  allLayoutViews,
  dockLeaves,
  useWorkspaceStore,
  WorkspaceViewRouteScope,
  type WorkspaceLayout,
} from "@/features/app-windows";
import { useMistyStore } from "@/features/agents/conversations/state/useMistyStore";
import { agentChatRoute, openWorkspaceRoute } from "@/app/layouts/DesktopLayout/spaceNavigation";
import AgentsPage from "./AgentsPage";

/** The Agents page in a real workspace view, as a window shows it, so the view writes its own
 * address back the way it does in the app. */
function View() {
  const view = useWorkspaceStore((state) => allLayoutViews(state.layout)[0]);
  return view ? (
    <WorkspaceViewRouteScope tab={view}>
      <AgentsPage />
    </WorkspaceViewRouteScope>
  ) : null;
}

/** Follows a link from the window's sidebar into the focused view. */
const follow = (route: string) => act(() => openWorkspaceRoute(route, () => undefined));
const page = () => document.querySelector(".agent-studio")?.getAttribute("data-page");
const route = () => allLayoutViews(useWorkspaceStore.getState().layout)[0]?.route;

beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  useWorkspaceStore.getState().reset();
  fixture.includeSecond = true;
  useMistyStore.setState({
    conversations: [
      conversation("first", "hello", "communications"),
      conversation("second", "hello", "research"),
    ],
  });
});

it("opens another agent's chat with the same title from the sidebar", () => {
  follow(agentChatRoute("communications", "first"));
  render(
    <MemoryRouter>
      <View />
    </MemoryRouter>,
  );
  expect(useMistyStore.getState().activeConversationId).toBe("first");

  follow(agentChatRoute("research", "second"));
  expect(useMistyStore.getState().activeConversationId).toBe("second");
  expect(useMistyStore.getState().selectedAgentId).toBe("research");
  expect(route()).toBe(agentChatRoute("research", "second"));

  follow(agentChatRoute("communications", "first"));
  expect(useMistyStore.getState().activeConversationId).toBe("first");
  expect(route()).toBe(agentChatRoute("communications", "first"));
});

it("opens a page from the sidebar while a chat is open, and the chat again after", () => {
  follow(agentChatRoute("communications", "first"));
  render(
    <MemoryRouter>
      <View />
    </MemoryRouter>,
  );
  expect(page()).toBe("task");

  follow("/agents?view=lab");
  expect(page()).toBe("lab");
  expect(route()).toBe("/agents?view=lab");

  follow("/agents?view=studio");
  expect(page()).toBe("studio");

  follow(agentChatRoute("research", "second"));
  expect(page()).toBe("task");
  expect(useMistyStore.getState().activeConversationId).toBe("second");
});

it("switches chats while another agent's run is still working", () => {
  follow(agentChatRoute("communications", "first"));
  render(
    <MemoryRouter>
      <View />
    </MemoryRouter>,
  );
  act(() => useMistyStore.setState({ working: true, invocationConversationId: "first" }));

  follow(agentChatRoute("research", "second"));
  expect(useMistyStore.getState().activeConversationId).toBe("second");
  expect(route()).toBe(agentChatRoute("research", "second"));
});

/** One pane of a split, showing whichever view it holds, as `DockLeafView` does. */
function PaneView(props: { paneId: string }) {
  const view = useWorkspaceStore((state) => viewIn(state.layout, props.paneId));
  return view ? (
    <div data-testid={props.paneId}>
      <WorkspaceViewRouteScope key={view.id} tab={view}>
        <AgentsPage />
      </WorkspaceViewRouteScope>
    </div>
  ) : null;
}

const viewIn = (layout: WorkspaceLayout, paneId: string) => {
  const pane = dockLeaves(layout.root).find((leaf) => leaf.id === paneId);
  return pane?.views.find((view) => view.id === pane.activeViewId) ?? pane?.views[0];
};

it("sends the sidebar's links to the focused pane of a split, and leaves the other alone", () => {
  follow(agentChatRoute("communications", "first"));
  const left = useWorkspaceStore.getState().layout.focusedPaneId;
  const right = useWorkspaceStore.getState().splitPane(left, "right")!;
  render(
    <MemoryRouter>
      <PaneView paneId={left} />
      <PaneView paneId={right} />
    </MemoryRouter>,
  );
  const routeIn = (paneId: string) => viewIn(useWorkspaceStore.getState().layout, paneId)?.route;
  const pageIn = (paneId: string) =>
    screen.getByTestId(paneId).querySelector(".agent-studio")?.getAttribute("data-page");

  // The new pane has focus: a chat and then a page open there.
  follow(agentChatRoute("research", "second"));
  expect(routeIn(right)).toBe(agentChatRoute("research", "second"));
  expect(routeIn(left)).toBe(agentChatRoute("communications", "first"));
  follow("/agents?view=lab");
  expect(pageIn(right)).toBe("lab");
  expect(pageIn(left)).toBe("task");

  // Focusing the first pane sends the next link there.
  act(
    () =>
      void useWorkspaceStore
        .getState()
        .focusView(viewIn(useWorkspaceStore.getState().layout, left)!.id),
  );
  follow("/agents?view=studio");
  expect(pageIn(left)).toBe("studio");
  expect(pageIn(right)).toBe("lab");
  expect(routeIn(right)).toBe("/agents?view=lab");
});

it("starts a new chat from the sidebar's New, from a chat and from another agent's chat", () => {
  follow(agentChatRoute("communications", "first"));
  render(
    <MemoryRouter>
      <View />
    </MemoryRouter>,
  );
  follow(agentChatRoute("communications", undefined, true));
  expect(useMistyStore.getState().activeConversationId).toBe("");
  expect(page()).toBe("task");

  follow(agentChatRoute("research", "second"));
  follow(agentChatRoute("communications", undefined, true));
  expect(useMistyStore.getState().activeConversationId).toBe("");
  expect(useMistyStore.getState().selectedAgentId).toBe("communications");
});
