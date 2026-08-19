import { githubCodeApi, type GitHubCodeWorkspace } from "@/api/integrations/github";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeGitPush } from "../native";
import { useGitStore } from "../git/useGitStore";
import { GitHubLinkedWorkspaces } from "./GitHubLinkedWorkspaces";
import { useGitHubCodeStore } from "./useGitHubCodeStore";

vi.mock("@/api/integrations/github", () => ({
  githubCodeApi: {
    createHandoff: vi.fn(),
    mutate: vi.fn(),
    syncWorkspace: vi.fn(),
    records: vi.fn(),
    unlinkWorkspace: vi.fn(),
  },
}));
vi.mock("../native", () => ({
  codeGitClone: vi.fn(),
  codeGitCommit: vi.fn(),
  codeGitCreateBranch: vi.fn(),
  codeGitFetch: vi.fn(),
  codeGitPush: vi.fn(),
  codeGitWorkspaceId: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ join: vi.fn() }));
vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn() }));

const workspace = {
  id: "workspace-1",
  space_id: "space-1",
  installation_id: "installation-1",
  shared_resource_id: "resource-1",
  bound_by_user_id: "account-1",
  repository_id: 7,
  full_name: "misty-labs/app",
  default_branch: "main",
  clone_url: "https://github.com/misty-labs/app.git",
  html_url: "https://github.com/misty-labs/app",
  private: true,
  client_workspace_id: "local_opaque",
  permissions: { pull: true, push: true },
  status: "active",
  created_at: "2026-08-19T12:00:00Z",
  updated_at: "2026-08-19T12:00:00Z",
} satisfies GitHubCodeWorkspace;

describe("GitHubLinkedWorkspaces remote confirmations", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    useGitHubCodeStore.setState({
      scopeKey: "account:space-1",
      installations: [],
      workspaces: [workspace],
      repositoriesByInstallation: {},
      recordsByWorkspace: {},
      loading: false,
      busy: "",
      error: "",
    });
    useGitStore.setState({
      snapshot: { isRepo: true, branch: "feature", ahead: 1, behind: 0, files: [] },
    });
    vi.mocked(githubCodeApi.createHandoff).mockResolvedValue({
      handoff: "opaque-once",
      redeem_path: "/native/github/credential-handoffs/redeem",
      expires_at: "2026-08-19T12:00:00Z",
    });
    vi.mocked(githubCodeApi.mutate).mockResolvedValue({
      operation: "create_pull_request",
      result: {},
    });
    vi.mocked(githubCodeApi.syncWorkspace).mockResolvedValue({
      workspace,
      records_synced: 1,
    });
    vi.mocked(githubCodeApi.records).mockResolvedValue({ records: [] });
  });

  it("does not push until the user confirms", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Push…" }));
    expect(codeGitPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(codeGitPush).toHaveBeenCalledWith(
        "/repo",
        "https://misty.test/native/github/credential-handoffs/redeem",
        "opaque-once",
      ),
    );
  });

  it("does not create a pull request until confirmed and sends confirmed true", async () => {
    renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText("Pull request title"), {
      target: { value: "Ship feature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create pull request…" }));
    expect(githubCodeApi.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(githubCodeApi.mutate).toHaveBeenCalledWith(
        "space-1",
        "workspace-1",
        expect.objectContaining({
          operation: "create_pull_request",
          confirmed: true,
          payload: expect.objectContaining({ head: "feature", base: "main" }),
        }),
      ),
    );
  });
});

function renderWorkspace() {
  return render(
    <GitHubLinkedWorkspaces
      spaceId="space-1"
      canManage
      rootPath="/repo"
      localWorkspaceId="local_opaque"
      onOpenRoot={vi.fn()}
      resolveRedeemUrl={async (path) => `https://misty.test${path}`}
    />,
  );
}
