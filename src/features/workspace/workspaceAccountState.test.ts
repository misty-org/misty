import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import {
  saveAccountWorkspace,
  restoreAccountWorkspace,
  removeAccountWorkspace,
  resetWorkspaceAccountState,
} from "./workspaceAccountState";

describe("workspaceAccountState per-account isolation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("saves and restores distinct workspace layouts for different accounts", () => {
    // User A sets up their workspace
    useWorkspaceStore.getState().setScope("space:family");
    useWorkspaceStore.getState().openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code Editor",
      route: "/code",
      forceNew: true,
    });
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:family");

    // Switch to User B: save A, reset, restore B (which has nothing yet)
    saveAccountWorkspace("user-a");
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-b");

    // User B should start on a clean "global" scope
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("global");

    // User B sets up their own workspace
    useWorkspaceStore.getState().setScope("space:matthew-personal");
    saveAccountWorkspace("user-b");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:matthew-personal");

    // Switch back to User A: restore A
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-a");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:family");

    // Switch back to User B: restore B
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-b");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:matthew-personal");
  });

  it("adoptDefaultScope adopts new scope when current scope is global", () => {
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("global");
    useWorkspaceStore.getState().adoptDefaultScope("space:default-1");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:default-1");
  });

  it("adoptDefaultScope recovers from an orphaned scope not in validScopes", () => {
    // Current user was somehow left on an old user's space "space:family"
    useWorkspaceStore.getState().setScope("space:family");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:family");

    // The active user only owns "space:personal"
    const validScopes = new Set(["space:personal"]);
    useWorkspaceStore.getState().adoptDefaultScope("space:personal", validScopes);

    // It must automatically re-adopt the valid default scope
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:personal");
  });

  it("adoptDefaultScope preserves current scope if it is already valid", () => {
    useWorkspaceStore.getState().setScope("space:project-x");
    const validScopes = new Set(["space:project-x", "space:default-1"]);
    useWorkspaceStore.getState().adoptDefaultScope("space:default-1", validScopes);

    // Should stay on project-x since it is valid for this user
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:project-x");
  });

  it("removeAccountWorkspace purges persisted state for deleted account", () => {
    useWorkspaceStore.getState().setScope("space:temp");
    saveAccountWorkspace("deleted-user");
    removeAccountWorkspace("deleted-user");

    resetWorkspaceAccountState();
    restoreAccountWorkspace("deleted-user");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("global");
  });
});
