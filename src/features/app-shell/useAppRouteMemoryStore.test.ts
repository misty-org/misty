import { beforeEach, describe, expect, it } from "vitest";
import { isRememberableAppRoute, useAppRouteMemoryStore } from "./store/useAppRouteMemoryStore";

describe("browser workspace route memory", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppRouteMemoryStore.getState().resetAppRoute();
  });

  it("starts in the browser and keeps agent conversation destinations", () => {
    expect(useAppRouteMemoryStore.getState().lastAppRoute).toBe("/browser");
    useAppRouteMemoryStore.getState().rememberAppRoute("/agents?conversation=thread-1");
    expect(useAppRouteMemoryStore.getState().lastAppRoute).toBe("/agents?conversation=thread-1");
    useAppRouteMemoryStore.getState().rememberAppRoute("/browser?url=https%3A%2F%2Fexample.com");
    expect(useAppRouteMemoryStore.getState().lastAppRoute).toBe("/browser");
  });

  it("does not remember retired tools, overlays, or external URLs", () => {
    useAppRouteMemoryStore.getState().rememberAppRoute("/files");
    for (const route of [
      "/code",
      "/store",
      "/discover",
      "/settings",
      "/account",
      "https://example.com",
      "//example.com",
      "/browser-evil",
    ]) {
      expect(isRememberableAppRoute(route)).toBe(false);
      useAppRouteMemoryStore.getState().rememberAppRoute(route);
    }
    expect(useAppRouteMemoryStore.getState().lastAppRoute).toBe("/files");
  });

  it.each(["/code", "/marketplace", "/home"])(
    "recovers an old %s startup into the browser",
    async (lastAppRoute) => {
      localStorage.setItem(
        "misty:app-route-memory",
        JSON.stringify({ state: { lastAppRoute, lastSpacesRoute: "/spaces/old" }, version: 0 }),
      );
      await useAppRouteMemoryStore.persist.rehydrate();
      expect(useAppRouteMemoryStore.getState().lastAppRoute).toBe("/browser");
      expect(useAppRouteMemoryStore.getState()).not.toHaveProperty("lastSpacesRoute");
    },
  );
});

it("remembers Space tool routes across reloads", async () => {
  const route = "/spaces/project/planner/tasks/list";
  useAppRouteMemoryStore.getState().rememberAppRoute(route);
  await useAppRouteMemoryStore.persist.rehydrate();
  expect(useAppRouteMemoryStore.getState().lastAppRoute).toBe(route);
});
