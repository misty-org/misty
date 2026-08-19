import { githubCodeApi, type GitHubCodeWorkspace } from "@/api/integrations/github";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGitHubCodeStore } from "./useGitHubCodeStore";

vi.mock("@/api/integrations/github", () => ({
  githubCodeApi: {
    installations: vi.fn(),
    workspaces: vi.fn(),
    repositories: vi.fn(),
    bindWorkspace: vi.fn(),
    syncWorkspace: vi.fn(),
    records: vi.fn(),
    disconnect: vi.fn(),
    unlinkWorkspace: vi.fn(),
  },
}));

describe("useGitHubCodeStore", () => {
  beforeEach(() => {
    useGitHubCodeStore.getState().reset();
    vi.clearAllMocks();
  });

  it("does not let a previous account overwrite the active account", async () => {
    const firstInstallations = deferred<{ installations: never[] }>();
    const firstWorkspaces = deferred<{ workspaces: never[] }>();
    vi.mocked(githubCodeApi.installations)
      .mockReturnValueOnce(firstInstallations.promise)
      .mockResolvedValueOnce({ installations: [] });
    vi.mocked(githubCodeApi.workspaces)
      .mockReturnValueOnce(firstWorkspaces.promise)
      .mockResolvedValueOnce({ workspaces: [] });

    const stale = useGitHubCodeStore.getState().load("account-a", "space-a");
    await useGitHubCodeStore.getState().load("account-b", "space-b");
    firstInstallations.resolve({ installations: [] });
    firstWorkspaces.resolve({ workspaces: [] });
    await stale;

    expect(useGitHubCodeStore.getState().scopeKey).toBe("account-b:space-b");
  });

  it("keeps repository provenance in memory and replaces synced workspaces", async () => {
    const workspace = {
      id: "workspace-1",
      installation_id: "installation-1",
      repository_id: 7,
    } as unknown as GitHubCodeWorkspace;
    vi.mocked(githubCodeApi.installations).mockResolvedValue({ installations: [] });
    vi.mocked(githubCodeApi.workspaces).mockResolvedValue({ workspaces: [workspace] });
    vi.mocked(githubCodeApi.syncWorkspace).mockResolvedValue({
      workspace: { ...workspace, status: "active" },
      records_synced: 1,
    });
    vi.mocked(githubCodeApi.records).mockResolvedValue({
      records: [{ id: "record-1", record_type: "commit" } as never],
    });

    await useGitHubCodeStore.getState().load("account-a", "space-a");
    await useGitHubCodeStore.getState().sync("space-a", "workspace-1");

    expect(useGitHubCodeStore.getState().recordsByWorkspace["workspace-1"]).toHaveLength(1);
    expect(localStorage.getItem("misty:github-code")).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
