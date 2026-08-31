import type { StoreApi } from "zustand";
import { aiPaneSession, aiMessage, aiSessionKey } from "./storeHelpers";
import type { AiPaneSession, AiSurfaceState } from "./store";
import type {
  AiArtifact,
  AiCompanionAnchor,
  AiInvocationEvent,
  AiSurfaceAdapter,
  MistySpeech,
} from "./types";

type SetState = StoreApi<AiSurfaceState>["setState"];
type GetState = StoreApi<AiSurfaceState>["getState"];

const speechTimers = new Map<string, number>();

export function patchSession(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  patch: Partial<AiPaneSession>,
) {
  const key = aiSessionKey(accountId, paneId);
  set({
    sessions: {
      ...get().sessions,
      [key]: { ...aiPaneSession(get().sessions, accountId, paneId), ...patch },
    },
  });
}

export function consumeInvocationEvent(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  adapter: AiSurfaceAdapter,
  event: AiInvocationEvent,
) {
  if (event.type === "invocation.started") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    return;
  }
  if (event.type === "assistant.status") {
    set((state) => ({
      companion: {
        ...state.companion,
        speech: makeSpeech("status", event.text || event.phase || "thinking", true),
      },
    }));
    return;
  }
  if (event.type === "invocation.failed") {
    failInvocation(set, get, accountId, paneId, event.error);
    return;
  }
  if (event.type === "invocation.canceled") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    return;
  }
  if (event.type === "invocation.completed") {
    patchSession(set, get, accountId, paneId, { state: event.state });
    if (get().companion.approval) return;
    const current = aiPaneSession(get().sessions, accountId, paneId);
    const reply = [...current.messages].reverse().find((message) => message.role === "assistant");
    const completedInBackground = get().companion.phase === "home";
    set((state) => ({
      companion: {
        ...state.companion,
        phase: completedInBackground ? "home" : "speaking",
        speech: makeSpeech(
          "reply",
          reply?.content || "Done.",
          false,
          reply?.content,
          current.conversationId,
        ),
        completedCount: state.companion.completedCount + 1,
      },
    }));
    if (!completedInBackground) scheduleHome(get, accountId);
    return;
  }
  if (event.type === "run.started") {
    patchSession(set, get, accountId, paneId, { runId: event.runId });
    return;
  }
  if (event.type === "effect.applied" || event.type === "undo.available") {
    return;
  }
  if (
    event.type === "tool.started" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed"
  ) {
    return;
  }
  if (event.type === "approval.required") return;

  const current = aiPaneSession(get().sessions, accountId, paneId);
  const messages = [...current.messages];
  let assistant = messages[messages.length - 1];
  if (!assistant || assistant.role !== "assistant") {
    assistant = {
      ...aiMessage("assistant", "", current.activeTaskId),
      invocationId: current.invocationId,
    };
    messages.push(assistant);
  }
  const replacement = { ...assistant };
  if (event.type === "response.delta") replacement.content += event.delta;
  if (event.type === "assistant.message") replacement.content = event.text;
  if (event.type === "citation") replacement.citations = [...replacement.citations, event.citation];
  if (event.type === "artifact.proposed")
    replacement.artifacts = [...replacement.artifacts, event.artifact];
  messages[messages.length - 1] = replacement;
  patchSession(set, get, accountId, paneId, { messages, state: "running" });

  if (event.type !== "artifact.proposed") return;
  if (event.artifact.approvalPolicy === "auto_apply_with_undo") {
    queueMicrotask(
      () => void get().decideArtifact(accountId, paneId, adapter, event.artifact, "accept"),
    );
    return;
  }
  const awaitingInBackground = get().companion.phase === "home";
  set((state) => ({
    companion: {
      ...state.companion,
      phase: awaitingInBackground ? "home" : "awaiting_approval",
      speech: makeSpeech("clarification", event.artifact.summary, true),
      approval: {
        artifact: event.artifact,
        title: event.artifact.title,
        summary: event.artifact.summary,
        confirmLabel: event.artifact.approvalPolicy === "always_confirm" ? "Confirm" : "Apply",
      },
      completedCount: awaitingInBackground
        ? state.companion.completedCount + 1
        : state.companion.completedCount,
    },
  }));
}

export function failInvocation(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  message: string,
) {
  patchSession(set, get, accountId, paneId, { state: "failed", error: message });
  set((state) => ({
    companion: {
      ...state.companion,
      phase: state.companion.phase === "home" ? "home" : "speaking",
      speech: makeSpeech("error", message, true),
      approval: undefined,
      completedCount:
        state.companion.phase === "home"
          ? state.companion.completedCount + 1
          : state.companion.completedCount,
    },
  }));
}

export function patchArtifact(
  set: SetState,
  get: GetState,
  accountId: string,
  paneId: string,
  artifactId: string,
  patch: Partial<AiArtifact>,
) {
  const current = aiPaneSession(get().sessions, accountId, paneId);
  patchSession(set, get, accountId, paneId, {
    messages: current.messages.map((item) => ({
      ...item,
      artifacts: item.artifacts.map((artifact) =>
        artifact.id === artifactId ? { ...artifact, ...patch } : artifact,
      ),
    })),
  });
}

export function pointerAnchor(
  paneId: string,
  anchor: AiCompanionAnchor | undefined,
  element: HTMLElement,
): AiCompanionAnchor {
  if (anchor?.kind === "pointer" && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
    return { ...anchor, paneId };
  }
  const bounds = element.getBoundingClientRect();
  return {
    kind: "pointer",
    paneId,
    x: anchor?.x ?? bounds.left + bounds.width / 2,
    y: anchor?.y ?? bounds.top + bounds.height / 2,
  };
}

export function makeSpeech(
  kind: MistySpeech["kind"],
  text: string,
  persistent = false,
  fullText?: string,
  conversationId?: string,
): MistySpeech {
  return {
    id: crypto.randomUUID(),
    kind,
    text: conciseSpeech(text),
    fullText,
    conversationId,
    persistent,
    createdAt: new Date().toISOString(),
  };
}

export function conciseSpeech(value: string) {
  // The compact presence bubble is plain text; the durable task transcript
  // renders the complete response as Markdown. Strip common Markdown syntax so
  // emphasis/list markers never leak into this one-line preview.
  const clean = value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)[#>*_~-]+\s*/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 240 ? `${clean.slice(0, 239)}…` : clean;
}

export function scheduleHome(get: GetState, accountId?: string) {
  if (!accountId) return;
  clearSpeechTimer(accountId);
  speechTimers.set(
    accountId,
    window.setTimeout(() => {
      const current = get().companion;
      if (
        current.accountId === accountId &&
        current.phase === "speaking" &&
        !current.speech?.persistent
      ) {
        get().settle();
      }
    }, 10_000),
  );
}

export function clearSpeechTimer(accountId?: string) {
  if (!accountId) return;
  const timer = speechTimers.get(accountId);
  if (timer !== undefined) window.clearTimeout(timer);
  speechTimers.delete(accountId);
}
