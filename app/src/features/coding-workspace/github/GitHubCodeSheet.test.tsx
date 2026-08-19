import { githubCodeApi } from "@/api/integrations/github";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { GitHubCodeSheet } from "./GitHubCodeSheet";
import { useGitHubCodeStore } from "./useGitHubCodeStore";

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("@/features/spaces", () => {
  const state = {
    spaces: [
      {
        id: "space-1",
        name: "Studio",
        role: "owner",
        permissions: { "integrations.manage": true },
      },
    ],
    snapshotReady: true,
    load: vi.fn(),
  };
  return { useSpacesStore: (selector: (value: typeof state) => unknown) => selector(state) };
});
vi.mock("@/api/integrations/github", () => ({
  githubCodeApi: {
    installations: vi.fn(),
    workspaces: vi.fn(),
    beginInstall: vi.fn(),
  },
}));
vi.mock("@/api/spaces/api", () => ({ resolveSpacesApiBase: vi.fn() }));
vi.mock("../native", () => ({ codeGitWorkspaceId: vi.fn() }));
vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn() }));

describe("GitHubCodeSheet", () => {
  afterEach(cleanup);
  beforeEach(() => {
    useGitHubCodeStore.getState().reset();
    useCodingWorkspaceStore.getState().setRootPath(null);
    vi.mocked(githubCodeApi.installations).mockResolvedValue({ installations: [] });
    vi.mocked(githubCodeApi.workspaces).mockResolvedValue({ workspaces: [] });
  });

  it("mounts GitHub management inside Code and scopes it to a Space", async () => {
    render(<GitHubCodeSheet open onOpenChange={vi.fn()} rootPath={null} onOpenRoot={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "GitHub for Code" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Space" }) as HTMLSelectElement).value).toBe(
      "space-1",
    );
    expect(screen.getByText("GitHub App")).toBeTruthy();
    expect(screen.getByText("Linked repositories")).toBeTruthy();
    await waitFor(() => expect(githubCodeApi.installations).toHaveBeenCalledWith("space-1"));
    expect(useGitHubCodeStore.getState().scopeKey).toBe("account-1:space-1");
  });
});
