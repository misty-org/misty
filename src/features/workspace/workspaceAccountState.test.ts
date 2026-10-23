import { deploymentStorageKey } from "@/api/deployment/api";
import { workspaceRecoveryKey } from "./workspaceRecoveryStorage";
import { partialWorkspaceStore } from "./workspaceStorePersistence";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { allLayoutViews } from "./layoutTabs";
import {
  adoptAccountWorkspace,
  liveWorkspace,
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
    const titles = () =>
      allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.title);
    // User A sets up their workspace
    useWorkspaceStore.getState().openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Code Editor",
      route: "/code",
      forceNew: true,
    });

    // Switch to User B: save A, reset, restore B (which has nothing yet)
    saveAccountWorkspace("user-a");
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-b");

    // User B starts in this window's Space with none of A's tabs
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:personal");
    expect(titles()).not.toContain("Code Editor");
    saveAccountWorkspace("user-b");

    // Switch back to User A: restore A
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-a");
    expect(titles()).toContain("Code Editor");

    // Switch back to User B: restore B
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-b");
    expect(titles()).not.toContain("Code Editor");
  });

  it("removeAccountWorkspace purges persisted state for deleted account", () => {
    useWorkspaceStore.getState().setScope("space:temp");
    saveAccountWorkspace("deleted-user");
    removeAccountWorkspace("deleted-user");

    resetWorkspaceAccountState();
    restoreAccountWorkspace("deleted-user");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:personal");
  });
});

it("backs up each legacy account before migration and removes its backup on account removal", () => {
  localStorage.clear();
  useWorkspaceStore.getState().reset();
  const key = deploymentStorageKey("misty:workspace-account:legacy-owner");
  const raw = JSON.stringify(partialWorkspaceStore(useWorkspaceStore.getState()));
  localStorage.setItem(key, raw);
  restoreAccountWorkspace("legacy-owner");
  saveAccountWorkspace("legacy-owner");
  expect(localStorage.getItem(workspaceRecoveryKey(key))).toBe(raw);
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
    version: 17,
    state: { activeScopeKey: "space:personal" },
  });
  removeAccountWorkspace("legacy-owner");
  expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem(workspaceRecoveryKey(key))).toBeNull();
});

describe("workspace adoption across sign-in", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("carries the windows on screen into the account that signs in, and back on sign-out", () => {
    const titles = () =>
      allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.title);
    useWorkspaceStore.getState().openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browsed signed out",
      route: "/browser",
      forceNew: true,
    });
    // Signing in: the live windows are captured, account state resets, the account adopts them.
    const live = liveWorkspace();
    resetWorkspaceAccountState();
    adoptAccountWorkspace("user-a", live);
    expect(titles()).toContain("Browsed signed out");

    // They are the account's now: restoring the account brings them back.
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-a");
    expect(titles()).toContain("Browsed signed out");

    // Signing out hands them to the local profile.
    const signedIn = liveWorkspace();
    resetWorkspaceAccountState();
    adoptAccountWorkspace("local", signedIn);
    resetWorkspaceAccountState();
    restoreAccountWorkspace("local");
    expect(titles()).toContain("Browsed signed out");
  });
});
