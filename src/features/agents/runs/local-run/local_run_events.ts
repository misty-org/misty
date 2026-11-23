import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { startTellingNativeTheAccount } from "../../personal/agent_account";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AiInvocationEvent } from "../invocations/invocation_types";

const eventName = "misty://agent-run-event";

type Listener = (event: AiInvocationEvent) => void;
type AnyListener = (runId: string, event: AiInvocationEvent) => void;
interface Published {
  runId: string;
  from: string;
  event: AiInvocationEvent;
}

const followers = new Map<string, Set<Listener>>();
const watchers = new Set<AnyListener>();
let listening = false;

const windowLabel = () => (hasTauriInternals() ? getCurrentWebview().label : "");

function deliver(runId: string, event: AiInvocationEvent) {
  for (const listener of followers.get(runId) ?? []) listener(event);
  for (const watcher of watchers) watcher(runId, event);
}

function listenOnce() {
  if (listening || !hasTauriInternals()) return;
  listening = true;
  startTellingNativeTheAccount();
  void getCurrentWebview().listen<Published>(eventName, ({ payload }) => {
    if (payload.from !== windowLabel()) deliver(payload.runId, payload.event);
  });
}

export async function endProposalRun(runId: string, event: AiInvocationEvent): Promise<void> {
  if (!hasTauriInternals()) return deliver(runId, event);
  await invoke("agent_run_end_proposal", { runId, event });
}

export function publishLocalRunEvent(runId: string, event: AiInvocationEvent): void {
  deliver(runId, event);
  if (!hasTauriInternals()) return;
  void invoke("agent_run_publish", { runId, event }).catch(() => undefined);
}

export function followLocalRunEvents(runId: string, listener: Listener): () => void {
  listenOnce();
  let listeners = followers.get(runId);
  if (!listeners) {
    listeners = new Set();
    followers.set(runId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = followers.get(runId);
    current?.delete(listener);
    if (current?.size === 0) followers.delete(runId);
  };
}

export function watchAllRunEvents(watcher: AnyListener): () => void {
  listenOnce();
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}
