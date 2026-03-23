import { create } from "zustand";
import {
  claudeAbort,
  claudeDrainEvents,
  claudeSendMessage,
  claudeStatus,
} from "../../../api/misty";
import type { ClaudeStatus, ClaudeStreamEvent } from "../../../api/types";
import { errorText } from "../../../shared/format";

export type ClaudePanelMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text: string;
};

interface SendClaudePromptRequest {
  displayPrompt: string;
  prompt: string;
  cwd: string | null;
}

interface ClaudeSessionStore {
  status: ClaudeStatus | null;
  messages: ClaudePanelMessage[];
  error: string | null;
  refreshStatus: () => Promise<void>;
  sendPrompt: (request: SendClaudePromptRequest) => Promise<void>;
  abortPrompt: () => Promise<void>;
  clearConversation: () => void;
}

let pollTimer: number | null = null;
let finalDrainAttempts = 0;
let nextMessageId = 1;

export const useClaudeSessionStore = create<ClaudeSessionStore>((set, get) => ({
  status: null,
  messages: [],
  error: null,

  refreshStatus: async () => {
    try {
      const status = await claudeStatus();
      set({ status, error: status.error });
      if (status.running) ensureClaudePolling(set, get);
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  sendPrompt: async ({ displayPrompt, prompt, cwd }) => {
    const trimmed = displayPrompt.trim();
    if (!trimmed || get().status?.running) return;

    set((state) => ({
      messages: [
        ...state.messages,
        { id: claudeMessageId("user"), role: "user", text: trimmed },
        { id: claudeMessageId("assistant"), role: "assistant", text: "" },
      ],
      error: null,
    }));
    finalDrainAttempts = 0;
    ensureClaudePolling(set, get);

    try {
      set({ status: await claudeSendMessage({ prompt, cwd, resumeSession: true }) });
    } catch (error) {
      const message = errorText(error);
      stopClaudePolling();
      set((state) => ({
        error: message,
        messages: appendClaudeEvents(removePendingAssistantMessage(state.messages), [claudeErrorEvent(message)]),
      }));
    }
  },

  abortPrompt: async () => {
    try {
      set({ status: await claudeAbort() });
      finalDrainAttempts = 0;
      ensureClaudePolling(set, get);
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  clearConversation: () => {
    set({ messages: [], error: null });
  },
}));

function ensureClaudePolling(
  set: (partial: Partial<ClaudeSessionStore> | ((state: ClaudeSessionStore) => Partial<ClaudeSessionStore>)) => void,
  get: () => ClaudeSessionStore,
): void {
  if (pollTimer !== null || typeof window === "undefined") return;
  pollTimer = window.setInterval(() => {
    void drainClaudeEvents(set, get);
  }, 400);
}

async function drainClaudeEvents(
  set: (partial: Partial<ClaudeSessionStore> | ((state: ClaudeSessionStore) => Partial<ClaudeSessionStore>)) => void,
  _get: () => ClaudeSessionStore,
): Promise<void> {
  try {
    const events = await claudeDrainEvents();
    if (events.length > 0) {
      set((state) => ({ messages: appendClaudeEvents(state.messages, events) }));
    }

    const status = await claudeStatus();
    set({ status, error: status.error });

    if (status.running) {
      finalDrainAttempts = 0;
      return;
    }
    if (finalDrainAttempts >= 2) {
      stopClaudePolling();
      return;
    }
    finalDrainAttempts += 1;
  } catch (error) {
    set({ error: errorText(error) });
  }
}

function stopClaudePolling(): void {
  if (pollTimer === null || typeof window === "undefined") return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

function appendClaudeEvents(messages: ClaudePanelMessage[], events: ClaudeStreamEvent[]): ClaudePanelMessage[] {
  let next = messages;
  for (const event of events) {
    if (event.kind === "text") {
      const text = event.text;
      if (!text) continue;
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next = [...next.slice(0, -1), { ...last, text: `${last.text}${text}` }];
      } else {
        next = [...next, { id: claudeMessageId("assistant"), role: "assistant", text }];
      }
    } else if (event.kind === "result") {
      const text = event.text;
      if (!text) continue;
      const last = next[next.length - 1];
      if (last?.role !== "assistant" || !last.text.includes(text)) {
        next = [...next, { id: claudeMessageId("assistant-result"), role: "assistant", text }];
      }
    } else if (event.kind === "tool_use") {
      next = [...next, {
        id: claudeMessageId("tool"),
        role: "tool",
        text: `${event.toolName}${event.toolInput ? `\n${event.toolInput}` : ""}`,
      }];
    } else if (event.kind === "tool_result" && event.toolResult) {
      next = [...next, {
        id: claudeMessageId("tool-result"),
        role: "tool",
        text: event.toolResult,
      }];
    } else if (event.kind === "error" && event.text) {
      next = [...next, { id: claudeMessageId("error"), role: "error", text: event.text }];
    }
  }
  return next;
}

function removePendingAssistantMessage(messages: ClaudePanelMessage[]): ClaudePanelMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.text.trim().length === 0) {
    return messages.slice(0, -1);
  }
  return messages;
}

function claudeMessageId(prefix: string): string {
  const id = `${prefix}-${Date.now()}-${nextMessageId}`;
  nextMessageId += 1;
  return id;
}

function claudeErrorEvent(message: string): ClaudeStreamEvent {
  return {
    kind: "error",
    sessionId: null,
    text: message,
    toolName: "",
    toolInput: "",
    toolUseId: "",
    toolResult: "",
    costUsd: 0,
  };
}
