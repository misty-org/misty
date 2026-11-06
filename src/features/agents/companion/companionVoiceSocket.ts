import { RuntimeSocket } from "@/api/runtimeSocket";

export interface ConversationTool {
  callId: string;
  name: "start_task" | "steer_task" | "cancel_task" | "get_task_status";
  instruction: string;
  key: string;
  invocationId: string;
}
export interface SavedVoiceTurn {
  id: string;
  prompt: string;
  reply: string;
  interrupted: boolean;
}

/** A promise with its resolve and reject at hand; an unawaited rejection is not reported. */
export function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * Opens the voice conversation on the agent runtime on this computer, which hears, answers and
 * speaks on this device's own models (docs/agents/runtime.md). `current` throws once the session it
 * was opened for has gone.
 */
export async function openVoiceSocket(current: () => void) {
  const socket = new RuntimeSocket({ kind: "voice" });
  await socket.opened;
  try {
    current();
  } catch (error) {
    socket.close();
    throw error;
  }
  return socket;
}
