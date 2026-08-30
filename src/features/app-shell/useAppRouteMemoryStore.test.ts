import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as AppShell from "@/features/app-shell";

let useAppRouteMemoryStore: (typeof AppShell)["useAppRouteMemoryStore"];

beforeAll(async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  useAppRouteMemoryStore = (await import("@/features/app-shell")).useAppRouteMemoryStore;
});

afterAll(() => vi.unstubAllGlobals());

describe("app route memory", () => {
  beforeEach(() => useAppRouteMemoryStore.getState().resetAppRoute());

  it("defaults to Home while preserving the Spaces workspace route", () => {
    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/home",
      lastSpacesRoute: "/spaces",
    });
  });

  it("remembers the exact Spaces destination separately from the current app route", () => {
    useAppRouteMemoryStore.getState().rememberAppRoute("/spaces/space-2/chat?conversation=group-4");
    useAppRouteMemoryStore.getState().rememberAppRoute("/files");

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/files",
      lastSpacesRoute: "/spaces/space-2/social/misty?conversation=group-4",
    });
  });

  it("remembers global navbar pages without changing the last Space", () => {
    useAppRouteMemoryStore.getState().rememberAppRoute("/spaces/space-2/library");
    for (const route of ["/files", "/agents", "/marketplace", "/code", "/transfers"])
      useAppRouteMemoryStore.getState().rememberAppRoute(route);

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/code",
      lastSpacesRoute: "/spaces/space-2/library",
    });
  });

  it("updates valid Spaces subsections and discards non-route fragments", () => {
    useAppRouteMemoryStore
      .getState()
      .rememberAppRoute("/spaces/space-7/settings/integrations#permissions");

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7/settings/connections",
      lastSpacesRoute: "/spaces/space-7/settings/connections",
    });
  });

  it("migrates removed Space surfaces to the Space root and strips stale query data", () => {
    useAppRouteMemoryStore
      .getState()
      .rememberAppRoute(
        "/spaces/space-7/agents/studio/workflows?workflowId=old&runId=old#activity",
      );

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7",
      lastSpacesRoute: "/spaces/space-7",
    });
  });

  it("keeps only query parameters used by the remembered Space surface", () => {
    useAppRouteMemoryStore
      .getState()
      .rememberAppRoute(
        "/spaces/space-7/chat?conversation=group-4&message=message-2&path=%2Fprivate",
      );

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7/social/misty",
      lastSpacesRoute: "/spaces/space-7/social/misty?conversation=group-4&message=message-2",
    });
  });

  it("remembers every external provider as a distinct Social page", () => {
    useAppRouteMemoryStore
      .getState()
      .rememberAppRoute("/spaces/space-7/social?provider=discord&conversation=group-4");

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7/social/discord",
      lastSpacesRoute: "/spaces/space-7/social/discord?conversation=group-4",
    });

    useAppRouteMemoryStore
      .getState()
      .rememberAppRoute("/spaces/space-7/social/x?conversation=direct-2");
    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7/social/x",
      lastSpacesRoute: "/spaces/space-7/social/x?conversation=direct-2",
    });
  });

  it("remembers restored Space surfaces including Assistant and Planner", () => {
    useAppRouteMemoryStore
      .getState()
      .rememberAppRoute("/spaces/space-7/planner/calendar?priority=high");
    expect(useAppRouteMemoryStore.getState().lastSpacesRoute).toBe(
      "/spaces/space-7/planner/calendar?priority=high",
    );

    useAppRouteMemoryStore.getState().rememberAppRoute("/spaces/space-7/assistant");
    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7/assistant",
      lastSpacesRoute: "/spaces/space-7/assistant",
    });
  });

  it("migrates legacy Tasks routes to Planner", () => {
    useAppRouteMemoryStore.getState().rememberAppRoute("/spaces/space-7/tasks/list?mine=1");

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7/planner/list",
      lastSpacesRoute: "/spaces/space-7/planner/list?mine=1",
    });
  });
});
