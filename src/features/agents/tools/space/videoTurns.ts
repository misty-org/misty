import type { VideoProjectDocument } from "@/features/files";

/**
 * Each agent turn's video projects as they were before its first change to each, so the turn
 * can be taken back as a whole (the Agent tab's Revert). Kept for the window's life, for the
 * latest turns only.
 */
const KEPT_TURNS = 50;
const before = new Map<
  string,
  Map<string, { spaceId: string; document: VideoProjectDocument; at: number }>
>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Calls back whenever a turn changes a project or is forgotten. */
export function onVideoTurns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The turns that changed a project, newest first: their run and when they first changed it. */
export function videoTurnsFor(itemId: string): Array<{ runId: string; at: number }> {
  return [...before.entries()]
    .flatMap(([runId, turn]) => {
      const kept = turn.get(itemId);
      return kept ? [{ runId, at: kept.at }] : [];
    })
    .sort((a, b) => b.at - a.at);
}

/** Notes a project as it was before a run first changed it; later changes in the run keep the first. */
export function noteBeforeVideoChange(
  runId: string,
  spaceId: string,
  itemId: string,
  document: VideoProjectDocument,
): void {
  let turn = before.get(runId);
  if (!turn) {
    turn = new Map();
    before.set(runId, turn);
    if (before.size > KEPT_TURNS) before.delete(before.keys().next().value as string);
  }
  if (!turn.has(itemId)) {
    turn.set(itemId, { spaceId, document: structuredClone(document), at: Date.now() });
    changed();
  }
}

/** The projects a run changed, each as it was before the run. */
export function videoTurnBefore(runId: string) {
  return [...(before.get(runId)?.entries() ?? [])].map(([itemId, kept]) => ({ itemId, ...kept }));
}

export function forgetVideoTurn(runId: string): void {
  if (before.delete(runId)) changed();
}
