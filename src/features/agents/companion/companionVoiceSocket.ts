import { agentsApi } from "@/api/agents/api";
import { resolveApiBase } from "@/api/deployment/api";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";

export interface ConversationTool {
  callId: string;
  name: "start_task" | "steer_task" | "cancel_task";
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
 * Opens the voice conversation's socket for this device with a one-time ticket. `current`
 * throws once the session it was opened for has gone.
 */
export async function openVoiceSocket(
  conversationId: string,
  signal: AbortSignal,
  current: () => void,
) {
  const snapshot = await agentsDeviceSnapshot();
  current();
  if (!snapshot.device || snapshot.device.status === "revoked")
    throw new Error("This device is unavailable.");
  const device = await ensureServerAgentDevice(snapshot.device);
  current();
  const { ticket } = await agentsApi.realtimeVoiceTicket(device.id, signal);
  const base = await resolveApiBase();
  current();
  const url = new URL(`${base}/agent-voice/realtime`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("mode", "conversation");
  url.searchParams.set("conversation", conversationId);
  return new WebSocket(url, ["misty-voice-v1", `misty-voice-auth.${ticket}`]);
}
