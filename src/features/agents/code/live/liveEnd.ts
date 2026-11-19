import { openUrl } from "@tauri-apps/plugin-opener";
import { gitApi } from "../../context-panel/git/gitApi";
import { codeSessionsApi } from "./codeSessionsApi";
import { liveApi } from "./liveApi";
import { planCommits, type CommitPlan } from "./liveCommits";
import { transactAsMain } from "./liveRoom";
import { leaveSession, runningSession } from "./liveSession";
import { rewriteText } from "./liveText";
import { mainAuthor, type LiveJoin, type LiveOutcome } from "./liveTypes";

/**
 * Ending a session, which only its starter does: one commit per person on the session branch in
 * their worktree, then the outcome they picked, then the server is told, and their worktree is
 * removed and unlinked. Until the commits are kept for good, a failure puts the branch back on
 * the base commit, so ending again builds them afresh from the shared text.
 */

export type EndStage = "commits" | "merge" | "land" | "push" | "pull request" | "close";

export type EndResult =
  | { kind: "ended"; outcome: LiveOutcome; url?: string }
  /** Main conflicted: the files are in the session now, for everyone to settle. */
  | { kind: "conflicts"; paths: string[] }
  /** Merging can't land in the person's checkout, and why; nothing changed. */
  | { kind: "blocked"; reason: string };

function runningOf(join: LiveJoin) {
  const running = runningSession(join.sessionId);
  if (!running) throw new Error("This session isn't open in this window.");
  return running;
}

/** What ending would commit, for the flow's preview. */
export async function previewEnd(join: LiveJoin): Promise<CommitPlan> {
  const { room, recorder } = runningOf(join);
  recorder.closeAll();
  return planCommits(room, join);
}

async function defaultBranchOf(join: LiveJoin): Promise<string> {
  const repo = await liveApi.repo(join.folder, join.baseCommit, false);
  if (!repo.defaultBranch) throw new Error("Misty can't tell which branch is main on origin.");
  return repo.defaultBranch;
}

/** Brings main's conflicts into the session as a step by main. */
async function takeConflicts(join: LiveJoin, files: Array<{ path: string; text: string }>) {
  const { room, recorder, mirror } = runningOf(join);
  for (const file of files) {
    const text = await mirror.ensureText(file.path);
    transactAsMain(room, () => rewriteText(text, file.text));
    recorder.closeNow(mainAuthor, file.path, "Merge conflicts from main in");
  }
}

async function makeCommits(join: LiveJoin) {
  const { room, recorder } = runningOf(join);
  recorder.closeAll();
  await liveApi.reset(join.folder, join.baseCommit);
  const plan = await planCommits(room, join);
  await liveApi.commit(join.folder, join.baseCommit, plan.commits);
  return plan;
}

async function closeSession(join: LiveJoin, outcome: LiveOutcome) {
  try {
    await codeSessionsApi.end(join.spaceId, join.sessionId, outcome);
  } catch (reason) {
    // Already ended (409): the worktree still goes.
    if ((reason as { status?: number } | null)?.status !== 409) throw reason;
  }
  await leaveSession(join, outcome === "pr" || outcome === "kept");
}

/** Ends the session with `outcome`, telling `onStage` what it is doing. */
export async function endSession(
  join: LiveJoin,
  outcome: LiveOutcome,
  onStage: (stage: EndStage) => void,
): Promise<EndResult> {
  if (outcome === "discarded") {
    onStage("close");
    await closeSession(join, outcome);
    return { kind: "ended", outcome };
  }
  const main = outcome === "kept" ? "" : await defaultBranchOf(join);
  if (outcome === "merged") {
    const reason = await liveApi.landCheck(join.spaceFolder, main);
    if (reason) return { kind: "blocked", reason };
  }
  onStage("commits");
  let plan: CommitPlan;
  try {
    plan = await makeCommits(join);
  } catch (reason) {
    await liveApi.reset(join.folder, join.baseCommit).catch(() => undefined);
    throw reason;
  }
  let url: string | undefined;
  try {
    if (outcome === "merged") {
      onStage("merge");
      const merged = await liveApi.merge(join.folder, main, plan.resolved);
      if (merged.status === "conflicts") {
        await liveApi.reset(join.folder, join.baseCommit);
        await takeConflicts(join, merged.files);
        return { kind: "conflicts", paths: merged.files.map((file) => file.path) };
      }
      onStage("land");
      await liveApi.land(join.spaceFolder, join.branch, main);
    }
    if (outcome === "pr") {
      onStage("push");
      await liveApi.push(join.folder);
      onStage("pull request");
      // A pull request already open for the branch is the one; otherwise one is opened.
      const open = await gitApi.pullRequest(join.folder).catch(() => null);
      if (open && open.state === "OPEN") url = open.url;
      else {
        const names = [...new Set(plan.preview.flatMap((commit) => commit.names))];
        const body = `Made in a Misty live session by ${names.join(", ")}.`;
        const link = await liveApi.openPullRequest(join.folder, main, join.name, body);
        url = link.url;
        if (!link.created) await openUrl(link.url).catch(() => undefined);
      }
    }
  } catch (reason) {
    // Nothing is kept from a merge or push that didn't finish; ending again starts over.
    if (outcome === "merged")
      await liveApi.reset(join.folder, join.baseCommit).catch(() => undefined);
    throw reason;
  }
  onStage("close");
  await closeSession(join, outcome);
  return { kind: "ended", outcome, url };
}
