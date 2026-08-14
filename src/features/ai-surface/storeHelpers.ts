import type { AiPaneSession } from "./store";
import type { AiTranscriptMessage } from "./types";

export function aiSessionKey(accountId: string, paneId: string) {
  return `${accountId}:${paneId}`;
}

export function aiPaneSession(
  sessions: Record<string, AiPaneSession>,
  accountId: string,
  paneId: string,
): AiPaneSession {
  return (
    sessions[aiSessionKey(accountId, paneId)] ?? {
      accountId,
      paneId,
      prompt: "",
      state: "idle",
      messages: [],
    }
  );
}

export function aiMessage(
  role: AiTranscriptMessage["role"],
  content = "",
  taskId?: string,
): AiTranscriptMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    citations: [],
    artifacts: [],
    taskId,
  };
}
