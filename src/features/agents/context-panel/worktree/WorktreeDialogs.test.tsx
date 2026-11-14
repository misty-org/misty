// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInfo, WorktreeListing } from "./worktreeApi";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/shared/platform/nativeInvoke", () => native);
vi.mock("../../personal/agentAccount", () => ({ agentAccountId: () => "me" }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }),
}));
vi.mock("../../engines/enginesApi", () => {
  const state = { load: vi.fn(() => Promise.resolve([])), choose: vi.fn() };
  const useSpaceFolders = Object.assign(
    (select: (value: typeof state) => unknown) => select(state),
    { getState: () => state },
  );
  return { currentSpaceKey: () => "space-1", folderOf: () => "", useSpaceFolders };
});

import { DeleteWorktreeDialog, warningsFor } from "./DeleteWorktreeDialog";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";
import { useWorktreeStore } from "./worktreeStore";

afterEach(cleanup);

const listing = (current: string): WorktreeListing => ({
  repository: "/repo/app",
  current,
  worktrees: [
    { path: "/repo/app", branch: current, head: "a", isMain: true, locked: false, prunable: false },
  ],
  branches: [
    { name: "main", isRemote: false },
    { name: "v1.0.9", isRemote: false },
    { name: "origin/main", isRemote: true },
  ],
});

describe("WorktreeCreateDialog", () => {
  beforeEach(() => {
    native.invoke.mockReset().mockResolvedValue(undefined);
    useWorktreeStore.setState({ pending: [] });
  });

  it("starts from the current branch, not the remote main", () => {
    render(
      <WorktreeCreateDialog
        folder="/repo/app"
        listing={listing("v1.0.9")}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Branch to start from" }).textContent).toContain(
      "v1.0.9",
    );
  });

  it("starts from origin/main when the current branch is main, which may lag behind", () => {
    render(
      <WorktreeCreateDialog
        folder="/repo/app"
        listing={listing("main")}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Branch to start from" }).textContent).toContain(
      "origin/main",
    );
  });

  it("shows where the worktree goes and refuses a branch that exists", () => {
    const onOpenChange = vi.fn();
    render(
      <WorktreeCreateDialog
        folder="/repo/app"
        listing={listing("main")}
        open
        onOpenChange={onOpenChange}
      />,
    );
    const name = screen.getByPlaceholderText("feature/parallel-review");
    fireEvent.change(name, { target: { value: "v1.0.9" } });
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    expect(
      (screen.getByRole("button", { name: "Create worktree" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(name, { target: { value: "feature/x" } });
    expect(
      (screen.getByDisplayValue("/repo/app-worktrees/feature-x") as HTMLInputElement).readOnly,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(native.invoke).toHaveBeenCalledWith(
      "project_worktree_create",
      expect.objectContaining({
        folder: "/repo/app",
        args: {
          space: "space-1",
          branch: "feature/x",
          baseRef: "origin/main",
          prNumber: null,
          existingBranch: false,
        },
      }),
    );
  });
});

const worktree: WorktreeInfo = {
  path: "/repo/app-worktrees/feat",
  branch: "feat",
  head: "b",
  isMain: false,
  locked: false,
  prunable: false,
  changed: 3,
  samples: ["a.ts", "b.ts"],
  ahead: 2,
};

describe("DeleteWorktreeDialog", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("lists uncommitted, unpushed and unmerged work", async () => {
    native.invoke.mockResolvedValue(false);
    render(
      <DeleteWorktreeDialog
        folder="/repo/app"
        worktree={worktree}
        branches={listing("main").branches}
        open
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/3 files have uncommitted changes \(a.ts, b.ts\)/)).toBeTruthy(),
    );
    expect(screen.getByText("2 commits haven't been pushed")).toBeTruthy();
    expect(screen.getByText(/isn't merged into origin\/main/)).toBeTruthy();
  });

  it("says when nothing would be lost", async () => {
    native.invoke.mockResolvedValue(true);
    render(
      <DeleteWorktreeDialog
        folder="/repo/app"
        worktree={{ ...worktree, changed: 0, samples: [], ahead: 0 }}
        branches={listing("main").branches}
        open
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("Nothing uncommitted or unpushed.")).toBeTruthy());
  });

  it("can't remove a locked worktree and says why", async () => {
    native.invoke.mockResolvedValue(true);
    render(
      <DeleteWorktreeDialog
        folder="/repo/app"
        worktree={{ ...worktree, locked: true, lockReason: "in use by CI" }}
        branches={[]}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("in use by CI");
    expect(
      (screen.getByRole("button", { name: "Remove worktree" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("deleting the branch too changes the button and removes in the background", async () => {
    native.invoke.mockResolvedValue(true);
    const remove = vi.fn(() => Promise.resolve());
    useWorktreeStore.setState({ remove });
    const onOpenChange = vi.fn();
    render(
      <DeleteWorktreeDialog
        folder="/repo/app"
        worktree={worktree}
        branches={[]}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Remove worktree and branch" }));
    expect(remove).toHaveBeenCalledWith({
      folder: "/repo/app",
      space: "space-1",
      worktree: worktree.path,
      branch: "feat",
      deleteBranch: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("words single counts in the singular", () => {
    expect(
      warningsFor({ uncommitted: 1, samples: [], unpushed: 1, merged: true }, "x", "main"),
    ).toEqual(["1 file has uncommitted changes", "1 commit hasn't been pushed"]);
  });
});
