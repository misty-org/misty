import { githubCodeApi, type GitHubInstallation } from "@/api/integrations/github";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubInstallations } from "./GitHubInstallations";
import { useGitHubCodeStore } from "./useGitHubCodeStore";

vi.mock("@/api/integrations/github", () => ({
  githubCodeApi: {
    repositories: vi.fn(),
    bindWorkspace: vi.fn(),
    disconnect: vi.fn(),
  },
}));
vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn() }));

const installation = {
  id: "installation-1",
  account_login: "misty-labs",
  status: "active",
} as GitHubInstallation;

describe("GitHubInstallations", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    useGitHubCodeStore.setState({
      scopeKey: "account:space-1",
      installations: [installation],
      workspaces: [],
      repositoriesByInstallation: {},
      recordsByWorkspace: {},
      loading: false,
      busy: "",
      error: "",
    });
  });

  it("discovers and binds a repository to the opaque local workspace id", async () => {
    vi.mocked(githubCodeApi.repositories).mockResolvedValue({
      repositories: [
        {
          id: 7,
          full_name: "misty-labs/app",
          default_branch: "main",
          clone_url: "https://github.com/misty-labs/app.git",
          html_url: "https://github.com/misty-labs/app",
          private: true,
          permissions: { pull: true, push: true },
        },
      ],
    });
    vi.mocked(githubCodeApi.bindWorkspace).mockResolvedValue({
      workspace: { id: "workspace-1", repository_id: 7 } as never,
      records_synced: 4,
    });

    render(
      <GitHubInstallations
        spaceId="space-1"
        canManage
        localWorkspaceId="local_opaque"
        onInstall={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose repositories" }));
    expect(await screen.findByText(/misty-labs\/app/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Link here" }));

    await waitFor(() =>
      expect(githubCodeApi.bindWorkspace).toHaveBeenCalledWith(
        "space-1",
        "installation-1",
        7,
        "local_opaque",
      ),
    );
  });

  it("surfaces reconnect and requires confirmation before disconnect", async () => {
    const onInstall = vi.fn(async () => undefined);
    useGitHubCodeStore.setState({
      installations: [{ ...installation, status: "needs_attention" }],
    });
    vi.mocked(githubCodeApi.disconnect).mockResolvedValue(undefined);
    render(
      <GitHubInstallations spaceId="space-1" canManage localWorkspaceId="" onInstall={onInstall} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onInstall).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Disconnect/ }));
    expect(githubCodeApi.disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(githubCodeApi.disconnect).toHaveBeenCalledWith("space-1", "installation-1"),
    );
  });
});
