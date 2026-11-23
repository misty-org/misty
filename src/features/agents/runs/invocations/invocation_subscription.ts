import { invoke } from "@tauri-apps/api/core";
import { followLocalRunEvents } from "../local-run/local_run_events";
import { runIdOfFollowAddress } from "../local-run/run_identity";
import type { AiInvocationEvent } from "./invocation_types";

interface RunFollow {
  state: string;
  events: AiInvocationEvent[];
}

export const readRunFollow = (runId: string) => invoke<RunFollow>("agent_run_follow", { runId });

export const readRunState = async (runId: string) =>
  (await invoke<RunFollow>("agent_run_follow", { runId, stateOnly: true })).state;

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
