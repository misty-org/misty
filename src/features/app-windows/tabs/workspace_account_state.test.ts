import { deploymentStorageKey } from "@/api/deployment/api";
import { workspaceRecoveryKey } from "../recovery/workspace_recovery_storage";
import { partialWorkspaceStore } from "./workspace_store_persistence";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./use_workspace_store";
import { allLayoutViews } from "../panes/layout_tabs";
import {
  adoptAccountWorkspace,
  liveWorkspace,
  saveAccountWorkspace,
  restoreAccountWorkspace,
  removeAccountWorkspace,
  resetWorkspaceAccountState,
} from "./workspace_account_state";
import { openPage } from "@/tests/workspace_page";

describe("workspaceAccountState per-account isolation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("saves and restores distinct workspace layouts for different accounts", () => {
    const titles = () =>
      allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.title);
    useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Code Editor",
      route: "/agents?conversation=code",
      forceNew: true,
    });

    saveAccountWorkspace("user-a");
    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-b");

    expect(titles()).not.toContain("Code Editor");
    saveAccountWorkspace("user-b");

    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-a");
    expect(titles()).toContain("Code Editor");

    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-b");
    expect(titles()).not.toContain("Code Editor");
  });

  it("removeAccountWorkspace purges persisted state for deleted account", () => {
    const tab = openPage(useWorkspaceStore.getState(), { url: "https://deleted.example" });
    saveAccountWorkspace("deleted-user");
    removeAccountWorkspace("deleted-user");

    resetWorkspaceAccountState();
    restoreAccountWorkspace("deleted-user");
    expect(
      allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.id),
    ).not.toContain(tab.id);
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
    version: 19,
    state: { activeWindowId: useWorkspaceStore.getState().activeWindowId },
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
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Browsed signed out",
      route: "/agents?conversation=signed-out",
      forceNew: true,
    });
    const live = liveWorkspace();
    resetWorkspaceAccountState();
    adoptAccountWorkspace("user-a", live);
    expect(titles()).toContain("Browsed signed out");

    resetWorkspaceAccountState();
    restoreAccountWorkspace("user-a");
    expect(titles()).toContain("Browsed signed out");

    const signedIn = liveWorkspace();
    resetWorkspaceAccountState();
    adoptAccountWorkspace("local", signedIn);
    resetWorkspaceAccountState();
    restoreAccountWorkspace("local");
    expect(titles()).toContain("Browsed signed out");
  });
});
