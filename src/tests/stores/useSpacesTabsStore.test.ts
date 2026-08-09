import { beforeEach, describe, expect, it } from "vitest";
import {
  activeSpacesTab,
  spacesTabsSessionKey,
  useSpacesTabsStore,
} from "@/stores/spaces/useSpacesTabsStore";

describe("per-Space workspace tabs", () => {
  beforeEach(() => useSpacesTabsStore.setState({ sessions: {} }));

  it("keeps independent tab sessions for each Space", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a", "/spaces/space-a/chat");
    store.ensureSession("account-1", "space-b", "/spaces/space-b/library");
    store.addTab("account-1", "space-a", "space", "/spaces/space-a/planner/tasks/board");

    const a = useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")];
    const b = useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-b")];
    expect(a.tabs.map((tab) => tab.kind)).toEqual(["space", "space"]);
    expect(b.tabs.map((tab) => tab.kind)).toEqual(["space"]);
  });

  it("creates distinct Space tabs with their own routes", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    const firstId = store.addTab("account-1", "space-a", "space", "/spaces/space-a/chat");
    const secondId = store.addTab("account-1", "space-a", "space", "/spaces/space-a/library");
    const session =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")];

    expect(firstId).not.toBe(secondId);
    expect(session.tabs.map(spaceTabRoute)).toEqual([
      expect.stringContaining("/spaces/space-a/"),
      "/spaces/space-a/chat",
      "/spaces/space-a/library",
    ]);
  });

  it("selects a different Space tab", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    const nextId = store.addTab("account-1", "space-a", "space", "/spaces/space-a/chat");
    const first =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")].tabs[0];
    store.selectTab("account-1", "space-a", first.id);

    const session =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")];
    expect(nextId).not.toBe(first.id);
    expect(activeSpacesTab(session)?.id).toBe(first.id);
  });

  it("updates only the active Space tab route", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a", "/spaces/space-a/notes");
    store.addTab("account-1", "space-a", "space", "/spaces/space-a/chat");
    store.updateActiveSpaceRoute("account-1", "space-a", "/spaces/space-a/library");

    const session =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")];
    expect(session.tabs.map(spaceTabRoute)).toEqual([
      "/spaces/space-a/notes",
      "/spaces/space-a/library",
    ]);
  });

  it("replaces the final closed tab with a fresh Space tab", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    const key = spacesTabsSessionKey("account-1", "space-a");
    const initial = activeSpacesTab(useSpacesTabsStore.getState().sessions[key]);
    store.closeTab("account-1", "space-a", initial?.id ?? "");

    const next = activeSpacesTab(useSpacesTabsStore.getState().sessions[key]);
    expect(next?.kind).toBe("space");
    expect(next?.id).not.toBe(initial?.id);
  });

  it("caps each Space at sixteen tabs", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    for (let index = 0; index < 15; index += 1)
      expect(store.addTab("account-1", "space-a", "space")).not.toBeNull();
    expect(store.addTab("account-1", "space-a", "space")).toBeNull();
  });

  it("prunes inaccessible Spaces without touching another account", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    store.addTab("account-1", "space-a", "space");
    store.ensureSession("account-1", "space-b");
    store.ensureSession("account-2", "space-a");

    const removed = store.pruneSessions("account-1", ["space-b"]);

    expect(removed).toHaveLength(2);
    expect(
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")],
    ).toBeUndefined();
    expect(
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-2", "space-a")],
    ).toBeDefined();
  });
});

function spaceTabRoute(tab: { kind: string; route?: string }): string {
  return tab.kind === "space" ? (tab.route ?? "") : "";
}
