import { runtimeAiApi as aiSurfaceApi } from "@/features/agents/agents_runtime";
import { submissionEpoch } from "./misty_submission_epoch";
import { settleRun } from "./settle_run";
import type { useMistyStore } from "../state/use_misty_store";

const TERMINAL = ["completed", "failed", "canceled"] as const;
const CHECK_EVERY_MS = 2_000;

type Terminal = (typeof TERMINAL)[number];
const isTerminal = (state: string): state is Terminal =>
  (TERMINAL as readonly string[]).includes(state);

const settledAs = (state: string): Terminal | null =>
  isTerminal(state) ? state : state === "missing" ? "failed" : null;

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
      if (now.invocationId !== invocationId || now.accountId !== accountId) return;
      const settled = settledAs(state);
      if (epoch !== submissionEpoch() || !settled) return;
      const conversationId = now.invocationConversationId ?? now.activeConversationId;
      settleRun(store.setState, store.getState, { state: settled, conversationId });
    } catch {
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
