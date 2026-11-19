import { runtimeAiApi } from "../../AgentsRuntime";
import { agentAccountId } from "../../personal/agentAccount";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { watchAllRunEvents } from "../../runs/local-run/localRunEvents";

/**
 * This person's agent runs at work in a session worktree, followed from the runs' own events: a
 * run is in a worktree once a tool call of it names a file there. An outside edit in that
 * worktree is then the agent's, not the person's, and the run's end closes the agent's step.
 * Runs on this computer are all the person's own, since an agent takes requests only from them.
 */

interface RunHere {
  folder: string;
  /** When it last reported, in ms. */
  at: number;
  /** Files its calls named, relative to the worktree. */
  paths: Set<string>;
}

/** A run that hasn't reported for this long is taken to be done with the worktree. */
const quietMs = 2 * 60 * 1000;
const ended = new Set(["invocation.completed", "invocation.failed", "invocation.canceled"]);

const runs = new Map<string, RunHere>();
const agentOfRun = new Map<string, Promise<{ id: string; name: string } | null>>();
const endListeners = new Set<(folder: string, agent: { id: string; name: string }) => void>();
let folders: () => readonly string[] = () => [];
let stopWatching: (() => void) | null = null;

function insideFolder(path: string): { folder: string; relative: string } | null {
  const clean = path.replace(/\\/g, "/");
  for (const folder of folders()) {
    const root = folder.replace(/\/+$/, "");
    if (clean.startsWith(`${root}/`)) return { folder, relative: clean.slice(root.length + 1) };
  }
  return null;
}

/** The agent a run belongs to, from the runs' activity; null for Misty's own work. */
function agentFor(runId: string): Promise<{ id: string; name: string } | null> {
  let found = agentOfRun.get(runId);
  if (!found) {
    found = runtimeAiApi
      .activity("")
      .then(({ entries }) => {
        const agentId = entries.find((entry) => entry.run_id === runId)?.agent_id;
        if (!agentId) return null;
        const store = usePersonalAgentsStore.getState();
        if (!store.agents.length) void store.load(agentAccountId());
        const profile = store.agents.find((agent) => agent.id === agentId);
        return { id: agentId, name: profile?.name || "Agent" };
      })
      .catch(() => null);
    agentOfRun.set(runId, found);
  }
  return found;
}

/** Starts following runs, for the worktrees `current` names. Idempotent. */
export function followAgentRuns(current: () => readonly string[]) {
  folders = current;
  if (stopWatching) return;
  stopWatching = watchAllRunEvents((runId, event) => {
    const known = runs.get(runId);
    if (ended.has(event.type)) {
      runs.delete(runId);
      if (known)
        void agentFor(runId).then((agent) => {
          if (agent) for (const listener of endListeners) listener(known.folder, agent);
        });
      return;
    }
    if (event.type === "tool.started" && event.path) {
      const inside = insideFolder(event.path);
      if (inside) {
        const run = known ?? { folder: inside.folder, at: 0, paths: new Set<string>() };
        run.paths.add(inside.relative);
        run.at = Date.now();
        runs.set(runId, run);
        void agentFor(runId);
        return;
      }
    }
    if (known) known.at = Date.now();
  });
}

/** Calls `listener` when one of the person's agent runs that worked in a worktree ends. */
export function onAgentRunEnded(
  listener: (folder: string, agent: { id: string; name: string }) => void,
): () => void {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}

/**
 * The agent whose run is at work in `folder` now, for an outside edit to `path` there: the run
 * whose calls named that file first, then the latest one at work there. Null when none is, and
 * the edit is the person's own.
 */
export async function agentEditing(
  folder: string,
  path: string,
): Promise<{ id: string; name: string } | null> {
  const now = Date.now();
  const here = [...runs.entries()]
    .filter(([, run]) => run.folder === folder && now - run.at < quietMs)
    .sort(
      (a, b) => Number(b[1].paths.has(path)) - Number(a[1].paths.has(path)) || b[1].at - a[1].at,
    );
  for (const [runId] of here) {
    const agent = await agentFor(runId);
    if (agent) return agent;
  }
  return null;
}
