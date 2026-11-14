import {
  useCollaborationStore,
  collaborationEventTypes,
  type CollaborationEvent,
} from "../../plans/agentCollaboration";
import type { AiCitation, AiInvocationEvent } from "../../runs/invocations";
import { settleProgress, withAnswer, withToolEvent } from "../../progress/progressTimeline";
import type { GlobalAiCitation } from "../state/conversationTypes";
import { withDeniedFolder } from "../view/grants/folderGrants";
import { useComposerChoices, type ComposerChoices } from "../composer/controls/composerChoices";
import { chooseEngineMode, effectivePermissionMode } from "../../plans/permissionMode";
import { engineModesFor } from "../../engines/engineModes";

import {
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
  updateConversation,
  type MistyGet,
  type MistySet,
} from "../state/mistyStoreUpdates";

interface PendingText {
  set: MistySet;
  get: MistyGet;
  conversationId: string;
  messageId: string;
  text: string;
}
const pendingText = new Map<string, PendingText>();
let scheduledFlush: (() => void) | null = null;

function scheduleFlush() {
  if (scheduledFlush) return;
  if (typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(() => flushStreamedText());
    scheduledFlush = () => cancelAnimationFrame(frame);
  } else {
    const timer = setTimeout(() => flushStreamedText(), 16);
    scheduledFlush = () => clearTimeout(timer);
  }
}

/** Applies buffered streamed text now. Every other event calls this first, so
 * nothing that follows a delta can apply before the text it follows. */
export function flushStreamedText() {
  scheduledFlush?.();
  scheduledFlush = null;
  const entries = [...pendingText.values()];
  pendingText.clear();
  for (const { set, get, conversationId, messageId, text } of entries) {
    const message = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((candidate) => candidate.id === messageId);
    // A message that finished, failed or was canceled keeps its state.
    const settled =
      message?.state === "completed" ||
      message?.state === "failed" ||
      message?.state === "canceled";
    patchConversationMessage(set, get, conversationId, messageId, {
      content: `${message?.content ?? ""}${text}`,
      ...(settled ? {} : { state: "streaming" as const, activity: undefined }),
    });
  }
}

export function applyGlobalInvocationEvent(
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  messageId: string,
  event: AiInvocationEvent,
) {
  if (event.type === "response.delta") {
    const key = `${conversationId}\u0000${messageId}`;
    const pending = pendingText.get(key);
    if (pending) pending.text += event.delta;
    else pendingText.set(key, { set, get, conversationId, messageId, text: event.delta });
    scheduleFlush();
    return;
  }
  flushStreamedText();
  if (event.type === "user.steering") {
    const invocationId = get().invocationId;
    const id = `${invocationId}-steering-${event.id}`;
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.some((m) => m.id === id)
        ? conversation.messages
        : [
            ...conversation.messages,
            {
              id,
              role: "user",
              mode: "ask",
              content: event.text,
              createdAt: new Date().toISOString(),
              state: "completed",
              activity: "Queued for the next safe boundary",
            },
          ],
    }));
    return;
  }
  if (event.type === "steering.received") {
    for (const message of event.messages)
      patchConversationMessage(
        set,
        get,
        conversationId,
        `${get().invocationId}-steering-${message.sequence}`,
        { activity: "Received by the agent" },
      );
    return;
  }
  if (event.type === "assistant.message") {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    patchConversationMessage(set, get, conversationId, messageId, {
      ...withAnswer(current ?? {}, event.text),
      state: "streaming",
      activity: undefined,
    });
    return;
  }
  if (event.type === "app.request") {
    patchConversationMessage(set, get, conversationId, messageId, { appRequest: event.appRequest });
    return;
  }
  if (collaborationEventTypes.has(event.type)) {
    useCollaborationStore.getState().applyEvent(conversationId, event as CollaborationEvent);
    return;
  }
  if (event.type === "conversation.title") {
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      title: event.text,
    }));
    return;
  }
  if (
    event.type === "engine.title" ||
    event.type === "engine.mode" ||
    event.type === "engine.choice"
  ) {
    void followEngineSession(get, conversationId, event);
    return;
  }
  if (event.type === "conversation.notes") {
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      historyNotes: event.data,
    }));
    return;
  }
  if (event.type === "notebook.updated") {
    patchConversationMessage(set, get, conversationId, messageId, { notebook: event.notebook });
    return;
  }
  if (event.type === "delegation.updated") {
    patchConversationMessage(set, get, conversationId, messageId, {
      subagents: event.delegation.children,
    });
    return;
  }
  if (event.type === "screen.request") {
    patchConversationMessage(set, get, conversationId, messageId, {
      screenRequest: { ...event.screenRequest, state: "pending" },
    });
    return;
  }
  if (event.type === "citation") {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    patchConversationMessage(set, get, conversationId, messageId, {
      citations: dedupeGlobalCitations([...(current?.citations ?? []), event.citation]),
    });
    return;
  }
  if (
    event.type === "tool.started" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.detail"
  ) {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    if (current)
      patchConversationMessage(set, get, conversationId, messageId, withToolEvent(current, event));
    return;
  }
  if (event.type === "usage.updated") {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    const previous = current?.usage ?? {};
    const pick = (value: number | null | undefined, kept: number | undefined) =>
      typeof value === "number" ? value : kept;
    patchConversationMessage(set, get, conversationId, messageId, {
      usage: {
        input: pick(event.input, previous.input),
        output: pick(event.output, previous.output),
        cacheRead: pick(event.cacheRead, previous.cacheRead),
        cacheWrite: pick(event.cacheWrite, previous.cacheWrite),
        used: pick(event.used, previous.used),
        // A report without a window keeps the one an earlier report gave.
        window: pick(event.window, previous.window),
        reasoning: pick(event.reasoning, previous.reasoning),
        costUsd: pick(event.costUsd, previous.costUsd),
      },
      ...(event.model ? { model: event.model } : {}),
    });
    return;
  }
  if (event.type === "permission.denied") {
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    if (current)
      patchConversationMessage(set, get, conversationId, messageId, {
        folderGrants: withDeniedFolder(current.folderGrants, event),
      });
    return;
  }
  if (event.type === "assistant.status") {
    patchConversationMessage(set, get, conversationId, messageId, {
      activity: event.text || event.phase,
      state: "pending",
    });
    return;
  }
  if (event.type === "invocation.completed") {
    replaceActiveGlobalInvocationStream();
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    const started = current ? Date.parse(current.createdAt) : NaN;
    patchConversationMessage(set, get, conversationId, messageId, {
      durationMs: event.durationMs ?? (Number.isFinite(started) ? Date.now() - started : undefined),
      ...(event.model ? { model: event.model } : {}),
      state: "completed",
      retryable: false,
      activity: undefined,
    });
    set({ working: false });
    return;
  }
  if (event.type === "invocation.failed" || event.type === "invocation.canceled") {
    replaceActiveGlobalInvocationStream();
    const content =
      event.type === "invocation.failed" ? event.error : "This Misty answer was canceled.";
    const current = get()
      .conversations.find((conversation) => conversation.id === conversationId)
      ?.messages.find((message) => message.id === messageId);
    patchConversationMessage(set, get, conversationId, messageId, {
      content,
      progress: settleProgress(current?.progress),
      state: event.type === "invocation.failed" ? "failed" : "canceled",
      retryable: event.type === "invocation.failed",
      activity: undefined,
    });
    // The transcript shows how the run ended; no popup over the composer.
    set({ working: false, error: null });
  }
}

type EngineSessionEvent = Extract<
  AiInvocationEvent,
  { type: "engine.title" | "engine.mode" | "engine.choice" }
>;

/**
 * The engine changed its own session in the turn, through a slash command typed there or a
 * switch of its own: the chat takes its title, mode or model, so the next turn asks for what the
 * engine now runs. Only what differs from the chat's own is changed, and only a mode the engine
 * offers in Misty.
 */
async function followEngineSession(
  get: MistyGet,
  conversationId: string,
  event: EngineSessionEvent,
) {
  if (event.type === "engine.title") {
    const title = event.title.trim();
    const conversation = get().conversations.find((item) => item.id === conversationId);
    if (title && conversation && conversation.title !== title)
      await get().renameConversation(conversationId, title);
    return;
  }
  if (event.type === "engine.mode") {
    const mode = (await engineModesFor(event.engine)).find((option) => option.id === event.mode);
    const saved = useCollaborationStore.getState().byConversation[conversationId];
    if (mode && effectivePermissionMode(saved, "") !== mode.id)
      await chooseEngineMode(conversationId, mode);
    return;
  }
  const account = get().accountId;
  const choices = useComposerChoices.getState();
  await choices.load(account, conversationId).catch(() => undefined);
  const known = useComposerChoices.getState().byConversation[conversationId];
  const patch: Partial<ComposerChoices> = {};
  if (event.model && event.model !== known?.model) patch.model = event.model;
  if (event.effort && event.effort !== known?.effort) patch.effort = event.effort;
  if (patch.model || patch.effort) choices.choose(account, conversationId, patch);
}

function dedupeGlobalCitations(citations: AiCitation[]) {
  return Array.from(
    new Map(
      citations.map((citation) => [
        citation.id,
        {
          id: citation.id,
          title: citation.title,
          href: citation.href,
          kind: citation.kind as GlobalAiCitation["kind"],
        },
      ]),
    ).values(),
  );
}
