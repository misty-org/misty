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
    store.addTab("account-1", "space-a", "transfers");

    const a = useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")];
    const b = useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-b")];
    expect(a.tabs.map((tab) => tab.kind)).toEqual(["space", "transfers"]);
    expect(b.tabs.map((tab) => tab.kind)).toEqual(["space"]);
  });

  it("always creates new tool instances with distinct File Manager workspaces", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    const firstId = store.addTab("account-1", "space-a", "file-manager");
    const secondId = store.addTab("account-1", "space-a", "file-manager");
    const session =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")];
    const fileTabs = session.tabs.filter((tab) => tab.kind === "file-manager");

    expect(firstId).not.toBe(secondId);
    expect(fileTabs).toHaveLength(2);
    expect(fileTabs[0].kind === "file-manager" ? fileTabs[0].workspaceId : "").not.toBe(
      fileTabs[1].kind === "file-manager" ? fileTabs[1].workspaceId : "",
    );
  });

  it("creates Agents as a normal top-level workspace tab", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    store.addTab("account-1", "space-a", "agents");

    const session =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")];
    expect(session.tabs.map((tab) => tab.kind)).toEqual(["space", "agents"]);
    expect(activeSpacesTab(session)).toMatchObject({ kind: "agents", title: "Agents" });
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
      expect(store.addTab("account-1", "space-a", "extensions")).not.toBeNull();
    expect(store.addTab("account-1", "space-a", "extensions")).toBeNull();
  });

  it("prunes inaccessible Spaces without touching another account", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account-1", "space-a");
    store.addTab("account-1", "space-a", "file-manager");
    store.ensureSession("account-1", "space-b");
    store.ensureSession("account-2", "space-a");

    const removed = store.pruneSessions("account-1", ["space-b"]);

    expect(removed.some((tab) => tab.kind === "file-manager")).toBe(true);
    expect(
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-a")],
    ).toBeUndefined();
    expect(
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-2", "space-a")],
    ).toBeDefined();
  });
});
