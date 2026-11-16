import { create } from "zustand";
import type { StudioAgent } from "./useStudioAgents";

/*
 * Results waiting to be collected. A finished task leaves its result on its agent's desk until the
 * person picks it up, which is their look at it: walking up to the desk, or the agent's panel. The
 * runs already collected are kept per account on this computer. The first look at the studio takes
 * whatever is already finished as collected, so nothing piles up from before.
 */

/** A result waits this long at most; older ones are old news. */
const WAIT_MS = 3 * 24 * 60 * 60_000;
/** The most collected runs kept; the oldest go first. */
const KEEP = 500;
const COLLECTED = "misty:studio-collected:";

function readCollected(account: string): string[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLECTED + account) ?? "null") as unknown;
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

function writeCollected(account: string, runs: readonly string[]) {
  try {
    localStorage.setItem(COLLECTED + account, JSON.stringify(runs));
  } catch {
    // Without storage a result is collected for as long as the window lasts.
  }
}

interface ResultsState {
  account: string;
  /** Collected run ids, oldest first; null until read for `account`. */
  collected: string[] | null;
  /** Reads the account's collected runs; with none kept yet, takes `finished` as collected. */
  start(account: string, finished: readonly string[]): void;
  collect(runId: string): void;
}

export const useStudioResults = create<ResultsState>((set, get) => ({
  account: "",
  collected: null,
  start(account, finished) {
    if (get().account === account && get().collected) return;
    const saved = readCollected(account);
    const collected = saved ?? [...finished];
    if (!saved) writeCollected(account, collected);
    set({ account, collected });
  },
  collect(runId) {
    const { account, collected } = get();
    if (!collected || collected.includes(runId)) return;
    const next = [...collected, runId].slice(-KEEP);
    set({ collected: next });
    if (account) writeCollected(account, next);
  },
}));

/** A finished task's result on its agent's desk. */
export interface StudioResult {
  agentId: string;
  runId: string;
  /** What the task was. */
  task: string;
  /** What the run handed back. */
  text: string;
  conversationId: string;
}

/** The runs that count as finished now, which the first look takes as already collected. */
export const finishedRuns = (agents: readonly StudioAgent[]) =>
  agents.filter((item) => item.outcome === "done" && item.runId).map((item) => item.runId);

/** Each agent's result still waiting, by agent id. */
export function waitingResults(
  agents: readonly StudioAgent[],
  collected: readonly string[] | null,
  now = Date.now(),
): Map<string, StudioResult> {
  const waiting = new Map<string, StudioResult>();
  if (!collected) return waiting;
  const taken = new Set(collected);
  for (const item of agents) {
    if (item.outcome !== "done" || !item.runId || taken.has(item.runId)) continue;
    if (now - item.endedAt > WAIT_MS) continue;
    waiting.set(item.agent.id, {
      agentId: item.agent.id,
      runId: item.runId,
      task: item.task,
      text: item.result,
      conversationId: item.conversationId,
    });
  }
  return waiting;
}
