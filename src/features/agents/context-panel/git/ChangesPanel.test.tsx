// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../files/filesStore", () => {
  const state = { selectedPath: null, repositories: {}, openFile: vi.fn(), refreshTree: vi.fn() };
  const useFilesStore = (select: (value: typeof state) => unknown) => select(state);
  useFilesStore.getState = () => state;
  return { useFilesStore };
});
vi.mock("../../runs/local-run/localRunEvents", () => ({ watchAllRunEvents: () => () => {} }));

import { ChangesPanel } from "./ChangesPanel";
import { useGitStore } from "./store";

const status = {
  branch: "main",
  ahead: 0,
  behind: 0,
  staged: [{ path: "staged-root.ts", status: "modified" as const }],
  unstaged: [
    {
      path: "src/features/git/ChangesPanel.tsx",
      status: "modified" as const,
      additions: 10,
      deletions: 2,
    },
    { path: "src/features/git/store.ts", status: "modified" as const, additions: 5, deletions: 0 },
    { path: "docs/readme.md", status: "modified" as const, additions: 1, deletions: 1 },
  ],
  untracked: [{ path: "new-file.ts", status: "added" as const }],
};

const actions = () => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  loadBranches: vi.fn().mockResolvedValue(undefined),
  stage: vi.fn().mockResolvedValue(undefined),
  unstage: vi.fn().mockResolvedValue(undefined),
  discard: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue("commit-hash-123"),
  init: vi.fn().mockResolvedValue(undefined),
  openDiff: vi.fn(),
});

function setStatus(value: unknown, extra: Record<string, unknown> = {}) {
  useGitStore.setState({
    statusByWorkspace: { "/repo": value as typeof status },
    notRepoByWorkspace: {},
    errorByWorkspace: {},
    branchesByWorkspace: {},
    diffView: null,
    ...actions(),
    ...extra,
  });
}

const tick = (name: string) => fireEvent.click(screen.getAllByRole("checkbox", { name })[0]);

function typeMessage(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
    target: { value: text },
  });
}

const commitButton = () => screen.getByRole("button", { name: /^Commit/ });

beforeEach(() => {
  setStatus(status);
});
afterEach(cleanup);

describe("ChangesPanel", () => {
  it("shows the changes as a tree by default, with folder chains folded together", () => {
    render(<ChangesPanel folder="/repo" />);
    expect(screen.getByText("src/features/git")).toBeTruthy();
    expect(screen.getByText("docs")).toBeTruthy();
    expect(screen.getByText("ChangesPanel.tsx")).toBeTruthy();
    expect(screen.getByText("readme.md")).toBeTruthy();
  });

  it("switches between the tree and a list of whole paths", () => {
    render(<ChangesPanel folder="/repo" />);
    fireEvent.click(screen.getByRole("button", { name: "View as list" }));
    expect(screen.queryByText("src/features/git")).toBeNull();
    expect(screen.getAllByText("src/features/git/").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "View as tree" }));
    expect(screen.getByText("src/features/git")).toBeTruthy();
  });

  it("collapses a folder in the tree", () => {
    render(<ChangesPanel folder="/repo" />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse folder src/features/git" }));
    expect(screen.queryByText("ChangesPanel.tsx")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand folder src/features/git" }));
    expect(screen.getByText("ChangesPanel.tsx")).toBeTruthy();
  });

  it("stages a ticked unstaged file before committing it", async () => {
    render(<ChangesPanel folder="/repo" />);
    tick("src/features/git/ChangesPanel.tsx");
    typeMessage("Add the tree view");
    expect(commitButton().textContent).toBe("Commit (2)");
    await act(async () => fireEvent.click(commitButton()));
    const git = useGitStore.getState();
    expect(git.stage).toHaveBeenCalledWith("/repo", ["src/features/git/ChangesPanel.tsx"]);
    expect(git.commit).toHaveBeenCalledWith("/repo", "Add the tree view");
  });

  it("asks before unstaging a staged file left unticked, and does nothing until confirmed", async () => {
    render(<ChangesPanel folder="/repo" />);
    tick("staged-root.ts");
    tick("src/features/git/ChangesPanel.tsx");
    typeMessage("Only the ticked file");
    fireEvent.click(commitButton());
    const git = useGitStore.getState();
    expect(git.commit).not.toHaveBeenCalled();
    expect(git.unstage).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Commit" })));
    expect(git.unstage).toHaveBeenCalledWith("/repo", ["staged-root.ts"]);
    expect(git.stage).toHaveBeenCalledWith("/repo", ["src/features/git/ChangesPanel.tsx"]);
    expect(git.commit).toHaveBeenCalledWith("/repo", "Only the ticked file");
  });

  it("leaves the index alone when that question is cancelled", () => {
    render(<ChangesPanel folder="/repo" />);
    tick("staged-root.ts");
    tick("src/features/git/ChangesPanel.tsx");
    typeMessage("Not this time");
    fireEvent.click(commitButton());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    const git = useGitStore.getState();
    expect(git.commit).not.toHaveBeenCalled();
    expect(git.unstage).not.toHaveBeenCalled();
    expect(git.stage).not.toHaveBeenCalled();
  });

  it("stages a partly staged file whole so it commits whole", async () => {
    setStatus({
      branch: "main",
      staged: [{ path: "partial.ts", status: "modified" }],
      unstaged: [{ path: "partial.ts", status: "modified", additions: 3, deletions: 1 }],
      untracked: [],
    });
    render(<ChangesPanel folder="/repo" />);
    typeMessage("The whole file");
    await act(async () => fireEvent.click(commitButton()));
    const git = useGitStore.getState();
    expect(git.stage).toHaveBeenCalledWith("/repo", ["partial.ts"]);
    expect(git.unstage).not.toHaveBeenCalled();
    expect(git.commit).toHaveBeenCalledWith("/repo", "The whole file");
  });

  it("asks before discarding a file's changes", async () => {
    render(<ChangesPanel folder="/repo" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Discard changes" })[0]);
    const git = useGitStore.getState();
    expect(git.discard).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Discard" })));
    expect(git.discard).toHaveBeenCalledTimes(1);
  });

  it("offers to initialize a folder that isn't a repository", async () => {
    setStatus(undefined, { notRepoByWorkspace: { "/repo": true } });
    render(<ChangesPanel folder="/repo" />);
    // Nothing Git does applies yet, so the head shows none of it.
    expect(screen.queryByRole("button", { name: /View as/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Initialize repository" })),
    );
    expect(useGitStore.getState().init).toHaveBeenCalledWith("/repo");
  });

  it("shows why the status couldn't be read instead of an empty body", () => {
    setStatus(undefined, { errorByWorkspace: { "/repo": "The repository couldn't be opened." } });
    render(<ChangesPanel folder="/repo" />);
    expect(screen.getByRole("alert").textContent).toContain("couldn't be opened");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(useGitStore.getState().refresh).toHaveBeenCalledWith("/repo", true);
  });

  it("shows ahead and behind beside the branch", () => {
    setStatus({ ...status, ahead: 2, behind: 1 });
    render(<ChangesPanel folder="/repo" />);
    expect(screen.getByText("↑2 ↓1")).toBeTruthy();
  });
});
