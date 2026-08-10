import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/native", () => ({
  providersConfigureRemote: vi.fn(),
  providersConfigPaths: vi.fn(),
  providersDisconnectRemote: vi.fn(),
  providersRefresh: vi.fn(),
  providersSaveRemote: vi.fn(),
  providersSelectRemote: vi.fn(),
  providersSnapshot: vi.fn(),
  providersTestRemote: vi.fn(),
}));

import { providersSaveRemote, providersTestRemote } from "@/native";
import type { RemoteEditDraft } from "@/native/contracts";
import { createProvidersWorkspaceState, useProvidersStore } from "../../store/useProvidersStore";

function draft(name: string): RemoteEditDraft {
  return {
    name,
    originalName: name,
    providerType: "drive",
    config: { type: "drive", client_id: "abc" },
    aboutJson: "",
    lastCheckedUnix: 0,
  };
}

function seedWorkspace(id: string, remoteName: string) {
  useProvidersStore.setState((state) => ({
    workspaces: {
      ...state.workspaces,
      [id]: {
        ...createProvidersWorkspaceState(),
        draft: draft(remoteName),
        originalDraft: draft(remoteName),
      },
    },
  }));
}

describe("Providers workspace feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProvidersStore.setState({
      workspaces: {},
      remoteRevisions: {},
      remoteDraftCache: {},
      providers: null,
      working: false,
      error: null,
      message: null,
    });
  });

  it("keeps a save failure on the pane that failed, leaving other panes clean", async () => {
    seedWorkspace("pane-a", "gdrive");
    seedWorkspace("pane-b", "dropbox");
    useProvidersStore.setState((state) => ({
      providers: {
        remotes: [
          { name: "gdrive", type: "drive" },
          { name: "dropbox", type: "dropbox" },
        ],
        workflows: [],
        health: { ready: true, error: null },
        error: null,
      } as never,
      // A dirty draft is required for a save to proceed.
      workspaces: {
        ...state.workspaces,
        "pane-a": {
          ...state.workspaces["pane-a"],
          draft: { ...draft("gdrive"), name: "gdrive-renamed" },
        },
      },
    }));
    vi.mocked(providersSaveRemote).mockRejectedValue(new Error("provider refused the config"));

    await useProvidersStore.getState().saveWorkspaceRemote("pane-a");

    const { workspaces } = useProvidersStore.getState();
    expect(workspaces["pane-a"].error).toContain("provider refused the config");
    expect(workspaces["pane-b"].error).toBeNull();
    expect(useProvidersStore.getState().working).toBe(false);
  });

  it("surfaces the stale guard on the pane instead of silently refusing to save", async () => {
    seedWorkspace("pane-a", "gdrive");
    // Bump the revision past what the pane loaded, marking it stale.
    useProvidersStore.setState({
      remoteRevisions: { gdrive: 5 },
      providers: {
        remotes: [{ name: "gdrive", type: "drive" }],
        workflows: [],
        health: { ready: true, error: null },
        error: null,
      } as never,
    });

    await useProvidersStore.getState().saveWorkspaceRemote("pane-a");

    expect(useProvidersStore.getState().workspaces["pane-a"].error).toBe(
      "This remote changed in another pane. Reload it before saving.",
    );
    expect(providersSaveRemote).not.toHaveBeenCalled();
  });

  it("reports a connection test result on the pane that ran it", async () => {
    seedWorkspace("pane-a", "gdrive");
    seedWorkspace("pane-b", "dropbox");
    vi.mocked(providersTestRemote).mockResolvedValue({
      message: "Connected. 2 TB available.",
      aboutJson: "",
      checkedUnix: 0,
    } as never);

    await useProvidersStore.getState().testWorkspaceConnection("pane-a");

    const { workspaces } = useProvidersStore.getState();
    expect(workspaces["pane-a"].message).toBe("Connected. 2 TB available.");
    expect(workspaces["pane-a"].error).toBeNull();
    expect(workspaces["pane-b"].message).toBeNull();
  });

  it("reports a failed connection test as a pane error", async () => {
    seedWorkspace("pane-a", "gdrive");
    vi.mocked(providersTestRemote).mockRejectedValue(new Error("token expired"));

    await useProvidersStore.getState().testWorkspaceConnection("pane-a");

    const workspace = useProvidersStore.getState().workspaces["pane-a"];
    expect(workspace.error).toContain("token expired");
    expect(workspace.message).toBeNull();
  });
});
