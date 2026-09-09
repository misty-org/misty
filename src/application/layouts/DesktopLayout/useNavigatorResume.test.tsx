import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { dockTabs, useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { useNavigatorResume } from "./useNavigatorResume";

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().reset();
});
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const open = (route: string, forceNew = false) =>
  useWorkspaceStore.getState().openSurface({
    ...workspaceSurfaceFromRoute(route)!,
    forceNew,
  });
it("resumes the most recently used app tab with its exact page and state", () => {
  const first = open("/apps/social?provider=instagram&pin=messages");
  open("/apps/social?provider=discord", true);
  useWorkspaceStore.getState().focusTab(first.id);
  const state = { scroll: 72, draft: "Keep this" };
  useWorkspaceStore.getState().updateTabState(first.id, state);
  open("/apps/files");
  const before = dockTabs(useWorkspaceStore.getState().layout.root).map((t) => t.id);
  const { result } = renderHook(
    () => ({
      resume: useNavigatorResume({
        accountId: "a",
        key: "social",
        fallbackRoute: "/apps/social?provider=misty",
      }),
      location: useLocation(),
    }),
    { wrapper },
  );
  act(() => result.current.resume());
  expect(result.current.location.search).toBe("?provider=instagram&pin=messages");
  const tabs = dockTabs(useWorkspaceStore.getState().layout.root);
  expect(tabs.map((t) => t.id)).toEqual(before);
  expect(tabs.find((t) => t.id === first.id)?.state).toBe(state);
});
it("restores a provider's last pin when the shared tab has since changed providers", () => {
  const instagram = "/apps/social?provider=instagram&pin=messages";
  const tab = open(instagram);
  const { result, rerender } = renderHook(
    ({ activeRoute }) =>
      useNavigatorResume({
        accountId: "a",
        key: "social/instagram",
        fallbackRoute: "/apps/social?provider=instagram",
        activeRoute,
        matchesRoute: (route) => route.includes("provider=instagram"),
      }),
    { wrapper, initialProps: { activeRoute: instagram as string | undefined } },
  );
  act(() => useWorkspaceStore.getState().updateTabRoute(tab.id, "/apps/social?provider=discord"));
  rerender({ activeRoute: undefined });
  act(() => result.current());
  const tabs = dockTabs(useWorkspaceStore.getState().layout.root).filter(
    (t) => t.surfaceId === "official-app",
  );
  expect(tabs).toHaveLength(1);
  expect(tabs[0].route).toBe(instagram);
  expect(tabs[0].id).toBe(tab.id);
});
it("restores only a tab belonging to the requested Space", () => {
  const first = open("/apps/social?space=one&provider=instagram&pin=messages");
  open("/apps/social?space=two&provider=discord");
  const { result } = renderHook(
    () =>
      useNavigatorResume({
        accountId: "a",
        key: "social",
        fallbackRoute: "/apps/social?space=one&provider=misty",
      }),
    { wrapper },
  );
  act(() => result.current());
  const state = useWorkspaceStore.getState();
  expect(state.activeScopeKey).toBe("space:one");
  expect(dockTabs(state.layout.root).map((t) => t.id)).toContain(first.id);
});
it("opens the app default when there is no existing page", () => {
  const { result } = renderHook(
    () =>
      useNavigatorResume({
        accountId: "a",
        key: "browser",
        fallbackRoute: "/apps/browser",
      }),
    { wrapper },
  );
  act(() => result.current());
  expect(
    dockTabs(useWorkspaceStore.getState().layout.root).some((tab) => tab.route === "/apps/browser"),
  ).toBe(true);
});
it("returns to the page without reopening the integration drawer", () => {
  const tab = open("/apps/social?provider=instagram&drawer=integrations");
  open("/apps/files");
  const { result } = renderHook(
    () =>
      useNavigatorResume({
        accountId: "a",
        key: "social",
        fallbackRoute: "/apps/social",
      }),
    { wrapper },
  );
  act(() => result.current());
  expect(
    dockTabs(useWorkspaceStore.getState().layout.root).find((t) => t.id === tab.id)?.route,
  ).toBe("/apps/social?provider=instagram");
});

it("does not let an older open tab override the page just visited", () => {
  const tab = open("/apps/social?provider=misty");
  const remembered = "/apps/social?provider=instagram&pin=messages";
  const { result, rerender } = renderHook(
    ({ activeRoute }) =>
      useNavigatorResume({
        accountId: "a",
        key: "social",
        fallbackRoute: "/apps/social",
        activeRoute,
      }),
    { wrapper, initialProps: { activeRoute: remembered as string | undefined } },
  );
  rerender({ activeRoute: undefined });
  act(() => result.current());
  expect(
    dockTabs(useWorkspaceStore.getState().layout.root).find((t) => t.id === tab.id)?.route,
  ).toBe(remembered);
});
it("forgets a remembered route when the sidebar switches Spaces", () => {
  const remembered = "/apps/social?space=one&provider=instagram&pin=messages";
  open(remembered);
  const { result, rerender } = renderHook(
    ({ fallbackRoute, activeRoute }) =>
      useNavigatorResume({
        accountId: "a",
        key: "social",
        fallbackRoute,
        activeRoute,
      }),
    {
      wrapper,
      initialProps: {
        fallbackRoute: "/apps/social?space=one",
        activeRoute: remembered as string | undefined,
      },
    },
  );
  act(() => useWorkspaceStore.getState().setScope("space:two"));
  rerender({ fallbackRoute: "/apps/social?space=two", activeRoute: undefined });
  act(() => result.current());
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:two");
  expect(
    dockTabs(useWorkspaceStore.getState().layout.root).some(
      (t) => t.route === "/apps/social?space=two",
    ),
  ).toBe(true);
});
