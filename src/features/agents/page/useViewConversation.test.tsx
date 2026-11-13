import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import {
  allLayoutViews,
  layoutTabs,
  useWorkspaceStore,
  WorkspaceViewRouteScope,
  workspaceSurfaceFromRoute,
  dockTreeViews,
} from "@/features/app-windows";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { terminalChatKey, useTerminalStore } from "../context-panel/terminal/terminalStore";
import { useViewConversation } from "./useViewConversation";

const workspace = () => useWorkspaceStore.getState();

function Probe(props: { name: string }) {
  const [params, setParams] = useSearchParams();
  const view = useViewConversation({
    agentId: params.get("agent") ?? undefined,
    linkedConversationId: params.get("conversation"),
    linkedNew: params.get("new"),
    params,
    setParams,
  });
  return <div data-testid={props.name}>{view.conversationId}</div>;
}

function View(props: { id: string; name: string }) {
  const view = useWorkspaceStore((state) =>
    allLayoutViews(state.layout).find((candidate) => candidate.id === props.id),
  );
  return view ? (
    <WorkspaceViewRouteScope tab={view}>
      <Probe name={props.name} />
    </WorkspaceViewRouteScope>
  ) : null;
}

const tabOf = (viewId: string) =>
  layoutTabs(workspace().layout).find((tab) =>
    dockTreeViews(tab.root).some((view) => view.id === viewId),
  )!.id;

beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  workspace().reset();
  useMistyStore.setState({ activeConversationId: "", selectedAgentId: undefined, query: "" });
});
afterEach(cleanup);

it("keeps each Agents tab on its own chat and draft", () => {
  const first = workspace().addSurface(
    workspaceSurfaceFromRoute("/agents?agent=a&conversation=one")!,
  );
  const second = workspace().addSurface(
    workspaceSurfaceFromRoute("/agents?agent=a&conversation=two")!,
  );
  useMistyStore.setState({ activeConversationId: "two", selectedAgentId: "a" });
  render(
    <MemoryRouter initialEntries={["/agents"]}>
      <View id={first.id} name="first" />
      <View id={second.id} name="second" />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("first").textContent).toBe("one");
  expect(screen.getByTestId("second").textContent).toBe("two");

  act(() => useMistyStore.getState().setQuery("draft in two"));
  act(() => void workspace().selectTab(tabOf(first.id)));
  expect(useMistyStore.getState().activeConversationId).toBe("one");
  expect(useMistyStore.getState().query).toBe("");
  expect(screen.getByTestId("first").textContent).toBe("one");
  expect(screen.getByTestId("second").textContent).toBe("two");

  act(() => void workspace().selectTab(tabOf(second.id)));
  expect(useMistyStore.getState().activeConversationId).toBe("two");
  expect(useMistyStore.getState().query).toBe("draft in two");
});

it("writes a chat started in a view into that view's address", () => {
  const view = workspace().addSurface(workspaceSurfaceFromRoute("/agents?agent=a&new=1")!);
  render(
    <MemoryRouter initialEntries={["/agents"]}>
      <View id={view.id} name="view" />
    </MemoryRouter>,
  );
  act(() => useMistyStore.setState({ activeConversationId: "fresh" }));
  const route = allLayoutViews(workspace().layout).find((item) => item.id === view.id)!.route;
  expect(route).toBe("/agents?agent=a&conversation=fresh");
});

it("gives a new chat's terminals to it once it is sent", () => {
  useTerminalStore.setState({ tabsByChat: {}, activeByChat: {}, launchTabs: {} });
  const view = workspace().addSurface(workspaceSurfaceFromRoute("/agents?agent=a&new=1")!);
  render(
    <MemoryRouter initialEntries={["/agents"]}>
      <View id={view.id} name="view" />
    </MemoryRouter>,
  );
  const shell = useTerminalStore.getState().newTab(terminalChatKey("", view.id), "/work/app");
  act(() => useMistyStore.setState({ activeConversationId: "sent" }));
  expect(useTerminalStore.getState().tabsByChat.sent?.map((tab) => tab.id)).toEqual([shell]);
});
