import { invoke } from "@tauri-apps/api/core";
import { followLocalRunEvents } from "../local-run/localRunEvents";
import { runIdOfFollowAddress } from "../local-run/runIdentity";
import type { AiInvocationEvent } from "./invocationTypes";

interface RunFollow {
  state: string;
  events: AiInvocationEvent[];
}

export const readRunFollow = (runId: string) => invoke<RunFollow>("agent_run_follow", { runId });

/** Only how a run stands, which a long run's whole event list needn't cross the bridge for. */
export const readRunState = async (runId: string) =>
  (await invoke<RunFollow>("agent_run_follow", { runId, stateOnly: true })).state;

/**
 * Follows a run: what it has said so far, then what it says next, each event once. Live events are held
 * back while the kept ones are read, since one can be in both, and whichever comes first is the one
 * delivered.
 */
export function subscribeToAiInvocation(
  address: string,
  handlers: {
    onEvent: (event: AiInvocationEvent) => void;
    onError: (error: Error) => void;
  },
): () => void {
  const runId = runIdOfFollowAddress(address);
  const seen = new Set<string>();
  let held: AiInvocationEvent[] | null = [];
  let stopped = false;
  const deliver = (event: AiInvocationEvent) => {
    if (stopped) return;
    const id = (event as { id?: string }).id;
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    handlers.onEvent(event);
  };
  const stopLive = followLocalRunEvents(runId, (event) => {
    if (held) held.push(event);
    else deliver(event);
  });
  void readRunFollow(runId)
    .then((follow) => {
      for (const event of follow.events) deliver(event);
      const waiting = held ?? [];
      held = null;
      for (const event of waiting) deliver(event);
      // Native knows nothing of it and nothing else is coming: it ended before this launch.
      if (follow.state === "missing" && !seen.size && !stopped)
        handlers.onError(new Error("This run stopped before it finished."));
    })
    .catch((error: unknown) => {
      if (stopped) return;
      held = null;
      handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });
  return () => {
    stopped = true;
    stopLive();
  };
}
