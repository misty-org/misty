// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type * as GitApiModule from "./gitApi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ init: vi.fn(), status: vi.fn() }));

vi.mock("./gitApi", async (importOriginal) => ({
  ...(await importOriginal<typeof GitApiModule>()),
  gitApi: api,
}));
vi.mock("../files/filesStore", () => ({
  useFilesStore: { getState: () => ({ refreshTree: () => Promise.resolve() }) },
}));

import { useGitStore } from "./store";

const freshStatus = { branch: "main", staged: [], unstaged: [], untracked: [] };

describe("git store init", () => {
  beforeEach(() => {
    useGitStore.setState({
      statusByWorkspace: {},
      notRepoByWorkspace: { "/plain": true },
      errorByWorkspace: {},
      fetchedAtByWorkspace: { "/plain": Date.now() },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("leaves the not-a-repository state with a fresh status by the time it resolves", async () => {
    let resolveStatus!: (status: typeof freshStatus) => void;
    api.init.mockResolvedValue(undefined);
    api.status.mockReturnValue(
      new Promise((done) => {
        resolveStatus = done;
      }),
    );
    let settled = false;
    const pending = useGitStore
      .getState()
      .init("/plain")
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
    // Still busy while the status is read: the panel would otherwise enable the button again
    // over a body that still says there's no repository.
    expect(settled).toBe(false);
    resolveStatus(freshStatus);
    await pending;

    expect(api.init).toHaveBeenCalledWith("/plain");
    // The TTL from the first answer doesn't skip the read, and the join shares its request.
    expect(api.status).toHaveBeenCalledTimes(1);
    const state = useGitStore.getState();
    expect(state.notRepoByWorkspace["/plain"]).toBe(false);
    expect(state.statusByWorkspace["/plain"]).toEqual(freshStatus);
  });

  it("asks again when a read from before init answers that there's no repository", async () => {
    let rejectStale!: (error: unknown) => void;
    api.init.mockResolvedValue(undefined);
    api.status
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectStale = reject;
        }),
      )
      .mockResolvedValue(freshStatus);
    // A refresh already in flight when the person clicks, such as one on window focus.
    const stale = useGitStore.getState().refresh("/plain", true);
    const pending = useGitStore.getState().init("/plain");
    await new Promise((done) => setTimeout(done, 0));
    rejectStale("NOT_A_REPO");
    await stale;
    await pending;

    expect(api.status).toHaveBeenCalledTimes(2);
    expect(useGitStore.getState().notRepoByWorkspace["/plain"]).toBe(false);
    expect(useGitStore.getState().statusByWorkspace["/plain"]).toEqual(freshStatus);
  });

  it("throws a failed init on and keeps the not-a-repository state", async () => {
    api.init.mockRejectedValue("That folder is gone.");
    api.status.mockRejectedValue("NOT_A_REPO");
    await expect(useGitStore.getState().init("/plain")).rejects.toThrow("That folder is gone.");
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(useGitStore.getState().notRepoByWorkspace["/plain"]).toBe(true);
  });

  it("explains a repository Git refuses to trust", async () => {
    api.status.mockRejectedValue("GIT_UNSAFE_REPO:repository path '/x' is owned by someone else");
    await useGitStore.getState().refresh("/x", true);
    const state = useGitStore.getState();
    expect(state.notRepoByWorkspace["/x"]).toBe(false);
    expect(state.errorByWorkspace["/x"]).toContain("safe.directory");
  });
});
