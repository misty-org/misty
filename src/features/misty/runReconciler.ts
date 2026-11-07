import { runtimeAiApi as aiSurfaceApi } from "@/features/agents/AgentsRuntime";
import { submissionEpoch } from "./mistySubmissionEpoch";
import { settleRun } from "./settleRun";
import type { useMistyStore } from "./useMistyStore";

const TERMINAL = ["completed", "failed", "canceled"] as const;
const CHECK_EVERY_MS = 2_000;

type Terminal = (typeof TERMINAL)[number];
const isTerminal = (state: string): state is Terminal =>
  (TERMINAL as readonly string[]).includes(state);

/** Nothing knows of the run: the app closed after it ended, so it reads as not finished. */
const settledAs = (state: string): Terminal | null =>
  isTerminal(state) ? state : state === "missing" ? "failed" : null;

/**
 * Events are the fast path, but a missed event or a stop from another surface
 * would leave the store working forever. While a run is marked working, ask the
 * crate for its real state on a timer and whenever the window returns, then
 * settle the store if the run is over.
 */
export function startRunReconciler(store: typeof useMistyStore) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking = false;

  const check = async () => {
    const { working, invocationId, accountId } = store.getState();
    if (!working || !invocationId || checking) return;
    const epoch = submissionEpoch();
    checking = true;
    try {
      const { state } = await aiSurfaceApi.invocationState(invocationId);
      const now = store.getState();
      // The run, account or submission changed while asking: this answer is stale.
      if (now.invocationId !== invocationId || now.accountId !== accountId) return;
      const settled = settledAs(state);
      if (epoch !== submissionEpoch() || !settled) return;
      const conversationId = now.invocationConversationId ?? now.activeConversationId;
      // Late events apply before this settles: a run that ended has said everything it will.
      settleRun(store.setState, store.getState, { state: settled, conversationId });
    } catch {
      // Native code didn't answer: the next check tries again.
    } finally {
      checking = false;
    }
  };

  const wake = () => {
    if (document.visibilityState === "visible") void check();
  };
  const sync = () => {
    const active = store.getState().working && Boolean(store.getState().invocationId);
    if (active && !timer) timer = setInterval(wake, CHECK_EVERY_MS);
    else if (!active && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const unsubscribe = store.subscribe(sync);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  sync();
  return () => {
    unsubscribe();
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
    if (timer) clearInterval(timer);
  };
}
