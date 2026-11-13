// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useState } from "react";
import type { useChangesSelection } from "./changesHooks";
import { gitErrorText, type GitStatus } from "./gitApi";
import { useGitStore } from "./store";

interface CommitPlan {
  message: string;
  toStage: string[];
  toUnstage: string[];
}

/** The changes, their busy and error state, and the commit that asks first when it would unstage. */
export function useChangesActions(
  repository: string,
  status: GitStatus | undefined,
  selection: ReturnType<typeof useChangesSelection>,
) {
  const { selectedFiles, setSelectedFiles } = selection;
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, true>>({});
  const [commitMsg, setCommitMsg] = useState("");
  /** Files waiting for the person to confirm throwing their changes away. */
  const [discardTarget, setDiscardTarget] = useState<string[] | null>(null);
  /** A commit waiting for confirmation because it would unstage files that were staged but left
   * unticked: that rearranges the index (hunks staged with `git add -p`), so never silently. */
  const [pendingCommitPlan, setPendingCommitPlan] = useState<CommitPlan | null>(null);

  const run = useCallback((key: string, action: () => Promise<unknown>) => {
    setPending((current) => ({ ...current, [key]: true }));
    setActionError(null);
    void action()
      .catch((error: unknown) => setActionError(gitErrorText(error)))
      .finally(() =>
        setPending((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        }),
      );
  }, []);

  /** A failed refresh clears the status, so its reason is the body's until a read succeeds; the
   * store's error is cleared here only when the notice shows it beside a status. */
  const dismissError = useCallback(() => {
    setActionError(null);
    if (status) useGitStore.getState().clearError(repository);
  }, [repository, status]);

  const stage = useCallback(
    (files: string[]) => {
      setSelectedFiles((previous) => new Set([...previous, ...files]));
      run("stage", () => useGitStore.getState().stage(repository, files));
    },
    [run, repository, setSelectedFiles],
  );
  const unstage = useCallback(
    (files: string[]) => {
      setSelectedFiles((previous) => {
        const next = new Set(previous);
        for (const file of files) next.delete(file);
        return next;
      });
      run("unstage", () => useGitStore.getState().unstage(repository, files));
    },
    [run, repository, setSelectedFiles],
  );
  const stageOne = useCallback((file: string) => stage([file]), [stage]);
  const unstageOne = useCallback((file: string) => unstage([file]), [unstage]);
  const discardRow = useCallback((file: string) => setDiscardTarget([file]), []);
  const confirmDiscard = useCallback(() => {
    if (discardTarget === null) return;
    const files = discardTarget;
    run("discard", () => useGitStore.getState().discard(repository, files));
    setDiscardTarget(null);
  }, [run, repository, discardTarget]);

  const runCommitPlan = useCallback(
    (plan: CommitPlan) =>
      run("commit", async () => {
        const git = useGitStore.getState();
        if (plan.toUnstage.length) await git.unstage(repository, plan.toUnstage);
        if (plan.toStage.length) await git.stage(repository, plan.toStage);
        await git.commit(repository, plan.message);
        setCommitMsg("");
      }),
    [run, repository],
  );
  const confirmCommitPlan = useCallback(() => {
    if (pendingCommitPlan === null) return;
    const plan = pendingCommitPlan;
    setPendingCommitPlan(null);
    runCommitPlan(plan);
  }, [pendingCommitPlan, runCommitPlan]);

  const commitSelected = useCallback(() => {
    const message = commitMsg.trim();
    if (!message || selectedFiles.size === 0 || !status) return;
    const staged = new Set(status.staged.map((file) => file.path));
    // A ticked file commits whole: what's still only in the folder is staged too, so a partly
    // staged file never commits half.
    const inFolder = new Set([
      ...status.unstaged.map((file) => file.path),
      ...status.untracked.map((file) => file.path),
    ]);
    const plan: CommitPlan = {
      message,
      toStage: [...selectedFiles].filter((path) => inFolder.has(path)),
      toUnstage: [...staged].filter((path) => !selectedFiles.has(path)),
    };
    if (plan.toUnstage.length) setPendingCommitPlan(plan);
    else runCommitPlan(plan);
  }, [commitMsg, selectedFiles, status, runCommitPlan]);

  const openStagedDiff = useCallback(
    (file: string) => useGitStore.getState().openDiff(repository, { file, staged: true }),
    [repository],
  );
  const openUnstagedDiff = useCallback(
    (file: string) => useGitStore.getState().openDiff(repository, { file, staged: false }),
    [repository],
  );

  return {
    actionError,
    pending,
    commitMsg,
    setCommitMsg,
    discardTarget,
    setDiscardTarget,
    pendingCommitPlan,
    setPendingCommitPlan,
    run,
    dismissError,
    stage,
    unstage,
    stageOne,
    unstageOne,
    discardRow,
    confirmDiscard,
    confirmCommitPlan,
    commitSelected,
    openStagedDiff,
    openUnstagedDiff,
  };
}
