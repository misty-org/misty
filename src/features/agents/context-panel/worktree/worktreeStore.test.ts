// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeCreateArgs, WorktreeCreateProgress } from "./worktreeApi";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/shared/platform/nativeInvoke", () => native);

vi.mock("../../personal/agentAccount", () => ({ agentAccountId: () => "me" }));

const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: listenMock }),
}));

const folders = vi.hoisted(() => ({ load: vi.fn(), choose: vi.fn() }));
vi.mock("../../engines/enginesApi", () => ({
  useSpaceFolders: { getState: () => folders },
}));

import { useWorktreeStore } from "./worktreeStore";

const FOLDER = "/repo/app";
const ARGS: WorktreeCreateArgs = {
  space: "space-1",
  branch: "pr-1842-x",
  baseRef: null,
  prNumber: 1842,
  existingBranch: false,
};

function progress(
  creationId: string,
  stage: WorktreeCreateProgress["stage"],
  extra: Partial<WorktreeCreateProgress> = {},
): WorktreeCreateProgress {
  return { creationId, stage, ...extra };
}

function startOne(switchAfter = true, args = ARGS): string {
  useWorktreeStore.getState().start(FOLDER, args, { switchAfter });
  return last(useWorktreeStore.getState().pending)!.creationId;
}

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

const createCalls = () =>
  native.invoke.mock.calls.filter(([command]) => command === "project_worktree_create");

describe("worktree store", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorktreeStore.setState({ pending: [], prefs: { switchAfter: true }, notice: "" });
    native.invoke.mockReset().mockResolvedValue(undefined);
    listenMock.mockReset().mockResolvedValue(() => {});
    folders.load.mockReset().mockResolvedValue([]);
    folders.choose.mockReset();
  });

  it("start adds a pending row and starts the native pipeline", () => {
    const id = startOne();
    const state = useWorktreeStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]).toMatchObject({
      creationId: id,
      folder: FOLDER,
      branch: "pr-1842-x",
      stage: "validate",
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "project_worktree_create",
      expect.objectContaining({ folder: FOLDER, creationId: id, args: ARGS }),
    );
  });

  it("progress updates the stage and detail of its own row only", () => {
    const id = startOne();
    const other = startOne();
    useWorktreeStore.getState().applyProgress(progress(id, "fetch", { message: "origin main" }));
    const [first, second] = useWorktreeStore.getState().pending;
    expect(first).toMatchObject({ creationId: id, stage: "fetch", detail: "origin main" });
    expect(second).toMatchObject({ creationId: other, stage: "validate" });
  });

  it("ignores progress for a creation it doesn't know", () => {
    startOne();
    useWorktreeStore.getState().applyProgress(progress("ghost", "add"));
    expect(useWorktreeStore.getState().pending[0].stage).toBe("validate");
  });

  it("done removes the row, reads the Space's folders and switches to the worktree", async () => {
    const id = startOne(true);
    useWorktreeStore
      .getState()
      .applyProgress(progress(id, "done", { path: "/repo/app-worktrees/pr-1842-x" }));
    expect(useWorktreeStore.getState().pending).toHaveLength(0);
    await vi.waitFor(() =>
      expect(folders.choose).toHaveBeenCalledWith("space-1", "/repo/app-worktrees/pr-1842-x"),
    );
    expect(folders.load).toHaveBeenCalledWith("space-1");
  });

  it("done without switching reads the folders but keeps the chat's folder", async () => {
    const id = startOne(false);
    useWorktreeStore.getState().applyProgress(progress(id, "done", { path: "/x" }));
    await vi.waitFor(() => expect(folders.load).toHaveBeenCalled());
    expect(folders.choose).not.toHaveBeenCalled();
  });

  it("failed keeps the row with its error for a retry", () => {
    const id = startOne();
    useWorktreeStore
      .getState()
      .applyProgress(progress(id, "failed", { errorKind: "fetch_failed", error: "boom" }));
    expect(useWorktreeStore.getState().pending[0]).toMatchObject({
      stage: "failed",
      errorKind: "fetch_failed",
      error: "boom",
    });
  });

  it("cancel goes to the native side", () => {
    const id = startOne();
    useWorktreeStore.getState().cancel(id);
    expect(native.invoke).toHaveBeenCalledWith("project_worktree_create_cancel", {
      creationId: id,
    });
  });

  it("retry starts a failed creation again with a new id and the same arguments", () => {
    const id = startOne();
    useWorktreeStore.getState().applyProgress(progress(id, "failed", { errorKind: "unknown" }));
    useWorktreeStore.getState().retry(id);
    const state = useWorktreeStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].creationId).not.toBe(id);
    expect(state.pending[0].stage).toBe("validate");
    expect(last(createCalls())?.[1]).toMatchObject({
      creationId: state.pending[0].creationId,
      args: ARGS,
    });
  });

  it("retry after a name clash renames with a new three-digit suffix", () => {
    const id = startOne();
    useWorktreeStore
      .getState()
      .applyProgress(progress(id, "failed", { errorKind: "branch_exists", error: "exists" }));
    useWorktreeStore.getState().retry(id);
    const row = useWorktreeStore.getState().pending[0];
    expect(row.branch).toMatch(/^pr-1842-x-\d{3}$/);
    expect(last(createCalls())?.[1]).toMatchObject({
      args: expect.objectContaining({ branch: row.branch }),
    });
  });

  it("retry replaces a suffix rather than adding a second one", () => {
    const id = startOne(true, { ...ARGS, branch: "pr-1842-x-482" });
    useWorktreeStore.getState().applyProgress(progress(id, "failed", { errorKind: "dir_exists" }));
    useWorktreeStore.getState().retry(id);
    const row = last(useWorktreeStore.getState().pending)!;
    expect(row.branch).toMatch(/^pr-1842-x-\d{3}$/);
    expect(row.branch).not.toBe("pr-1842-x-482");
  });

  it("retry does nothing for a creation still running", () => {
    const id = startOne();
    native.invoke.mockClear();
    useWorktreeStore.getState().retry(id);
    expect(createCalls()).toHaveLength(0);
    expect(useWorktreeStore.getState().pending[0].creationId).toBe(id);
  });

  it("a failed call with no event fails the row instead of spinning forever", async () => {
    native.invoke.mockRejectedValueOnce(new Error("native down"));
    const id = startOne();
    await vi.waitFor(() => expect(useWorktreeStore.getState().pending[0].stage).toBe("failed"));
    expect(useWorktreeStore.getState().pending[0].creationId).toBe(id);
  });

  it("dismiss removes the row without asking the native side", () => {
    const id = startOne();
    useWorktreeStore.getState().applyProgress(progress(id, "failed"));
    native.invoke.mockClear();
    useWorktreeStore.getState().dismiss(id);
    expect(useWorktreeStore.getState().pending).toHaveLength(0);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("remove reports what was kept and reads the folders again", async () => {
    native.invoke.mockResolvedValueOnce({
      orphanDirectory: false,
      branchDeleted: false,
      branchKeptReason: "checked_out_elsewhere",
    });
    await useWorktreeStore.getState().remove({
      folder: FOLDER,
      space: "space-1",
      worktree: "/repo/app-worktrees/x",
      branch: "x",
      deleteBranch: true,
    });
    expect(useWorktreeStore.getState().notice).toContain("Branch x is checked out somewhere else");
    expect(folders.load).toHaveBeenCalledWith("space-1");
  });

  it("setPrefs keeps the choice for next time in misty.db", async () => {
    native.invoke.mockImplementation(async (command: string) =>
      command === "settings_session_state" ? { revision: 3, state: null } : undefined,
    );
    useWorktreeStore.getState().setPrefs({ switchAfter: false });
    expect(useWorktreeStore.getState().prefs).toEqual({ switchAfter: false });
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("settings_session_commit", {
        scope: "worktree-prefs",
        revision: 3,
        document: { deviceSetting: 1, value: { switchAfter: false } },
      }),
    );
  });
});
