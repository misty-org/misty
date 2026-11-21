export interface ConversationTool {
  callId: string;
  name: "start_task" | "steer_task" | "cancel_task" | "get_task_status" | "reassign_task";
  instruction: string;
  /** The agent the person named for the work ("ask Ada to…"), or for reassign_task the new one. */
  agent?: string;
  key: string;
  invocationId: string;
}
export interface SavedVoiceTurn {
  id: string;
  prompt: string;
  reply: string;
  interrupted: boolean;
  /** The agent the turn's work was handed to, and the chat it went to. */
  handoff?: { agentId: string; conversationId: string };
  /** What was on screen when it was asked (`screenNote`). */
  seen?: string;
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

/** Bytes of one second of the companion's recording: 24 kHz mono PCM16. */
export const recordedRate = 24_000;
/** What the computer's recognizer takes: 16 kHz mono PCM16. */
export const recognizedRate = 16_000;

/** Base64 PCM16 at the recording's rate, as base64 PCM16 at the recognizer's. */
export function toRecognizerRate(audio: string): string {
  const raw = atob(audio);
  const count = Math.floor(raw.length / 2);
  const input = new Int16Array(count);
  for (let at = 0; at < count; at++) {
    const low = raw.charCodeAt(at * 2);
    const high = raw.charCodeAt(at * 2 + 1);
    input[at] = (((high << 8) | low) << 16) >> 16;
  }
  const ratio = recordedRate / recognizedRate;
  const length = Math.floor(count / ratio);
  let out = "";
  for (let at = 0; at < length; at++) {
    const position = at * ratio;
    const before = Math.floor(position);
    const after = Math.min(before + 1, count - 1);
    const weight = position - before;
    const sample = Math.round(input[before]! * (1 - weight) + input[after]! * weight);
    out += String.fromCharCode(sample & 0xff, (sample >> 8) & 0xff);
  }
  return btoa(out);
}
