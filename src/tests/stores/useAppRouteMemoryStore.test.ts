import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let useAppRouteMemoryStore: (typeof import("@/stores/app"))["useAppRouteMemoryStore"];

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
  useAppRouteMemoryStore = (await import("@/stores/app")).useAppRouteMemoryStore;
});

afterAll(() => vi.unstubAllGlobals());

describe("app route memory", () => {
  beforeEach(() => useAppRouteMemoryStore.getState().resetAppRoute());

  it("remembers the exact Spaces destination separately from the current app route", () => {
    useAppRouteMemoryStore.getState().rememberAppRoute("/spaces/space-2/chat?conversation=group-4");
    useAppRouteMemoryStore.getState().rememberAppRoute("/files");

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/files",
      lastSpacesRoute: "/spaces/space-2/chat?conversation=group-4",
    });
  });

  it("updates Spaces subsections and discards non-route fragments", () => {
    useAppRouteMemoryStore
      .getState()
      .rememberAppRoute("/spaces/space-7/settings/agents#permissions");

    expect(useAppRouteMemoryStore.getState()).toMatchObject({
      lastAppRoute: "/spaces/space-7/settings/agents",
      lastSpacesRoute: "/spaces/space-7/settings/agents",
    });
  });
});
