// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@/shared/platform/nativeInvoke", () => native);
vi.mock("../../personal/agentAccount", () => ({ agentAccountId: () => "me" }));
vi.mock("../../engines/enginesApi", () => ({
  useSpaceFolders: { getState: () => ({ load: vi.fn(), choose: vi.fn() }) },
}));

import { WorktreeProgressRow } from "./WorktreeProgressRow";
import { useWorktreeStore, type PendingCreation } from "./worktreeStore";

afterEach(cleanup);

const base: PendingCreation = {
  creationId: "c1",
  folder: "/repo/app",
  branch: "feat",
  stage: "failed",
  args: { space: "", branch: "feat", baseRef: "main", prNumber: null, existingBranch: false },
  switchAfter: true,
};

describe("WorktreeProgressRow", () => {
  it("shows why a repository that exists could not be opened", () => {
    render(
      <WorktreeProgressRow
        pending={{
          ...base,
          errorKind: "repo_open_failed",
          error: "repository path is not owned by current user",
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("not owned by current user");
  });

  it("keeps the plain wording for a folder that isn't a repository", () => {
    render(<WorktreeProgressRow pending={{ ...base, errorKind: "not_a_repo", error: "x" }} />);
    expect(screen.getByRole("alert").textContent).toContain("isn't a Git repository");
  });

  it("cancels a running creation and retries a failed one", () => {
    const cancel = vi.fn();
    const retry = vi.fn();
    useWorktreeStore.setState({ cancel, retry });
    const { rerender } = render(
      <WorktreeProgressRow pending={{ ...base, stage: "fetch", detail: "main" }} />,
    );
    expect(screen.getByText("Fetching main")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledWith("c1");
    rerender(<WorktreeProgressRow pending={{ ...base, errorKind: "fetch_failed" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith("c1");
  });
});
