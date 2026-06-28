import { create } from "zustand";
import {
  aiAbort,
  aiDrainEvents,
  aiSendMessage,
  aiStatus,
} from "../../../api/misty";
import type { AiStatus, AiStreamEvent } from "../../../api/types";
import { errorText } from "../../../shared/format";

export type AiPanelMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text: string;
};

interface SendAiPromptRequest {
  displayPrompt: string;
  prompt: string;
  cwd: string | null;
}

interface AiSessionStore {
  status: AiStatus | null;
  messages: AiPanelMessage[];
  error: string | null;
  refreshStatus: () => Promise<void>;
  sendPrompt: (request: SendAiPromptRequest) => Promise<void>;
  abortPrompt: () => Promise<void>;
  clearConversation: () => void;
}

let pollTimer: number | null = null;
let finalDrainAttempts = 0;
let nextMessageId = 1;

export const useAiSessionStore = create<AiSessionStore>((set, get) => ({
  status: null,
  messages: [],
  error: null,

  refreshStatus: async () => {
    try {
      const status = await aiStatus();
      set({ status, error: status.error });
      if (status.running) ensureAiPolling(set, get);
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
        { id: aiMessageId("user"), role: "user", text: trimmed },
        { id: aiMessageId("assistant"), role: "assistant", text: "" },
      ],
      error: null,
    }));
    finalDrainAttempts = 0;
    ensureAiPolling(set, get);

    try {
      set({ status: await aiSendMessage({ prompt, cwd, resumeSession: true }) });
    } catch (error) {
      const message = errorText(error);
      stopAiPolling();
      set((state) => ({
        error: message,
        messages: appendAiEvents(removePendingAssistantMessage(state.messages), [aiErrorEvent(message)]),
      }));
    }
  },

  abortPrompt: async () => {
    try {
      set({ status: await aiAbort() });
      finalDrainAttempts = 0;
      ensureAiPolling(set, get);
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  clearConversation: () => {
    set({ messages: [], error: null });
  },
}));

export const useClaudeSessionStore = useAiSessionStore;

function ensureAiPolling(
  set: (partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>)) => void,
  get: () => AiSessionStore,
): void {
  if (pollTimer !== null || typeof window === "undefined") return;
  pollTimer = window.setInterval(() => {
    void drainAiEvents(set, get);
  }, 400);
}

async function drainAiEvents(
  set: (partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>)) => void,
  _get: () => AiSessionStore,
): Promise<void> {
  try {
    const events = await aiDrainEvents();
    if (events.length > 0) {
      set((state) => ({ messages: appendAiEvents(state.messages, events) }));
    }

    const status = await aiStatus();
    set({ status, error: status.error });

    if (status.running) {
      finalDrainAttempts = 0;
      return;
    }
    if (finalDrainAttempts >= 2) {
      stopAiPolling();
      return;
    }
    finalDrainAttempts += 1;
  } catch (error) {
    set({ error: errorText(error) });
  }
}

function stopAiPolling(): void {
  if (pollTimer === null || typeof window === "undefined") return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

function appendAiEvents(messages: AiPanelMessage[], events: AiStreamEvent[]): AiPanelMessage[] {
  let next = messages;
  for (const event of events) {
    if (event.kind === "text") {
      const text = event.text;
      if (!text) continue;
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next = [...next.slice(0, -1), { ...last, text: `${last.text}${text}` }];
      } else {
        next = [...next, { id: aiMessageId("assistant"), role: "assistant", text }];
      }
    } else if (event.kind === "result") {
      const text = event.text;
      if (!text) continue;
      const last = next[next.length - 1];
      if (last?.role !== "assistant" || !last.text.includes(text)) {
        next = [...next, { id: aiMessageId("assistant-result"), role: "assistant", text }];
      }
    } else if (event.kind === "tool_use") {
      next = [...next, {
        id: aiMessageId("tool"),
        role: "tool",
        text: `${event.toolName}${event.toolInput ? `\n${event.toolInput}` : ""}`,
      }];
    } else if (event.kind === "tool_result" && event.toolResult) {
      next = [...next, {
        id: aiMessageId("tool-result"),
        role: "tool",
        text: event.toolResult,
      }];
    } else if (event.kind === "error" && event.text) {
      next = [...next, { id: aiMessageId("error"), role: "error", text: event.text }];
    }
  }
  return next;
}

function removePendingAssistantMessage(messages: AiPanelMessage[]): AiPanelMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.text.trim().length === 0) {
    return messages.slice(0, -1);
  }
  return messages;
}

function aiMessageId(prefix: string): string {
  const id = `${prefix}-${Date.now()}-${nextMessageId}`;
  nextMessageId += 1;
  return id;
}

function aiErrorEvent(message: string): AiStreamEvent {
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
