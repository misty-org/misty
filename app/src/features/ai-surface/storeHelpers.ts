import type { AiPaneSession } from "./store";
import type { AiCompanionAnchor, AiSurfaceAdapter, AiTranscriptMessage } from "./types";

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

export function resolveCompanionAnchor(
  paneId: string,
  adapter: AiSurfaceAdapter,
  element: HTMLElement,
): AiCompanionAnchor {
  const supplied = adapter.getAnchor?.();
  if (supplied) return { ...supplied, paneId };
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) {
      return {
        kind: "selection",
        paneId,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }
  }
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && element.contains(focused)) {
    const rect = focused.getBoundingClientRect();
    return {
      kind: "focus",
      paneId,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }
  const rect = element.getBoundingClientRect();
  return { kind: "focus", paneId, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
