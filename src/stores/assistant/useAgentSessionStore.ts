import type {
  AiPanelMessage,
  AssistantScope,
  AssistantRequestScope,
  AgentContextSource,
} from "@/models/types/stores/assistant/useAgentSessionStore";
export type {
  AiPanelMessage,
  AssistantScope,
  AssistantRequestScope,
  AgentContextSource,
} from "@/models/types/stores/assistant/useAgentSessionStore";
import type {
  AiStatus,
  AiPlanReview,
  AiToolApproval,
  SendAiPromptRequest,
  AiConversationSummary,
  AiSessionStore,
} from "@/models/interfaces/stores/assistant/useAgentSessionStore";
export type {
  AiStatus,
  AiPlanReview,
  AiToolApproval,
  SendAiPromptRequest,
  AiConversationSummary,
  AiSessionStore,
} from "@/models/interfaces/stores/assistant/useAgentSessionStore";
import { create } from "zustand";
import {
  explorerCreateItem,
  explorerListDirectory,
  explorerQueuePasteItems,
  explorerQueueRenameItem,
  searchQuery,
} from "@/stores/backend";
import { errorText } from "@/lib/format";
import {
  hydrateServerSessions,
  loadConversationTranscript,
} from "@/stores/assistant/agentSessionSync";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import { selectAssistantPreferences, useSettingsStore } from "@/stores/app";
import {
  cancelAgentSession,
  createAgentSession,
  deleteAgentSession,
  fetchAgentStatus,
  fetchAgentEvents,
  fetchAgentTranscript,
  listAgentSessions,
  renameAgentSession,
  sendAgentMessage,
  submitToolResults,
} from "@/stores/assistant/useAiServerStore";
import type { AiMode } from "@/models/types/stores/assistant/useAiServerStore";
import type {
  AgentStatusResponse,
  FileOperationPlan,
  ToolManifest,
  ToolRequest,
  ToolResult,
} from "@/models/interfaces/stores/assistant/useAiServerStore";
import { agentsPrepareDocument, agentsRegisterFolderScope } from "@/stores/agents/useAgentsStore";
import type { AgentCitation } from "@/models/interfaces/features/agents/types";
import {
  deviceRelativePath,
  isSafeRelativePath,
  agentServerContext,
} from "@/features/agents/pathPrivacy";
import { mistyDocumentsEnabled } from "@/features/agents/flags";
import { publicAgentDisplayName, publicAgentModel } from "./useAgentDelegationStore";
import { initialAgentModelId, initialAgentModelName } from "@/features/agents/modelSelection";

let pollTimer: number | null = null;
let nextMessageId = 1;
let nextPlanId = 1;
let activeSessionId: string | null = null;
let lastEventSequence = 0;
let activeRoot: string | null = null;
let activeScopeId: string | null = null;
let activeSelectedPaths: string[] = [];
let activeRequestScope: AssistantScope | null = null;
let activeContextSources: AgentContextSource[] = [];
// The active chat's per-chat model, overriding the agent's configured model.
// Null means the chat follows the agent's model (or the base default).
let activeAgentModelOverride: string | null = null;
let activeAgentReasoningOverride: string | null = null;
// Chats whose model was just switched while keeping their history. The next send
// replays the prior transcript to the new model so it continues the same thread.
const pendingReseedConversationIds = new Set<string>();
let drainInFlight: Promise<void> | null = null;
let abortRequested = false;
let agentRuntimeGeneration = 0;
const processedEventSequences = new Set<number>();
const processedToolRequestIds = new Set<string>();
const aiToolTimeoutMs = 15000;

class AgentRuntimeChangedError extends Error {
  constructor() {
    super("Agent conversation changed while the request was running.");
    this.name = "AgentRuntimeChangedError";
  }
}

function agentRuntimeIsCurrent(generation: number, sessionId?: string | null): boolean {
  return (
    generation === agentRuntimeGeneration &&
    (sessionId === undefined || sessionId === activeSessionId)
  );
}

function assertAgentRuntime(generation: number, sessionId?: string | null): void {
  if (!agentRuntimeIsCurrent(generation, sessionId)) throw new AgentRuntimeChangedError();
}

interface ConversationRuntimeSnapshot {
  sessionId: string | null;
  lastEventSequence: number;
  activeRoot: string | null;
  activeScopeId: string | null;
  activeSelectedPaths: string[];
  requestScope: AssistantScope | null;
  contextSources: AgentContextSource[];
}
interface StoredConversation {
  id: string;
  scopeKey: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  status: AiStatus | null;
  mode: AiMode;
  messages: AiPanelMessage[];
  plans: AiPlanReview[];
  toolApprovals: AiToolApproval[];
  error: string | null;
  /** False for a session hydrated from the server whose messages are not loaded yet. */
  transcriptLoaded: boolean;
  /** Model this chat is pinned to, overriding the agent/base default when set. */
  modelId?: string;
  /** Reasoning effort for this chat, overriding the agent default when set. */
  reasoningEffort?: string;
  runtime: ConversationRuntimeSnapshot;
}

const conversationSnapshots = new Map<string, StoredConversation>();
let nextConversationSeq = 1;
export const filesAgentScopeKey = "files";
let activeConversationScopeKey = filesAgentScopeKey;
let scopeActivationGeneration = 0;
const initialConversationId = newConversationId();

export function spaceAgentScopeKey(accountId: string, spaceId: string): string {
  return `account:${encodeURIComponent(accountId)}:space:${encodeURIComponent(spaceId)}`;
}

export function agentScopeKey(
  accountId: string,
  agentId = "",
  spaceId = "",
  modelId = "",
): string {
  const params = new URLSearchParams();
  if (agentId) params.set("agent", agentId);
  if (spaceId) params.set("space", spaceId);
  if (modelId) params.set("model", modelId);
  return `account:${encodeURIComponent(accountId)}:agents?${params.toString()}`;
}

function newConversationId(): string {
  return `agent-local-${Date.now()}-${nextConversationSeq++}`;
}

function emptyStoredConversation(
  id: string,
  now: number,
  scopeKey = activeConversationScopeKey,
): StoredConversation {
  return {
    id,
    scopeKey,
    title: "New chat",
    updatedAt: now,
    createdAt: now,
    status: serverStatus(false),
    mode: "auto",
    messages: [],
    plans: [],
    toolApprovals: [],
    error: null,
    transcriptLoaded: true,
    runtime: {
      sessionId: null,
      lastEventSequence: 0,
      activeRoot: null,
      activeScopeId: null,
      activeSelectedPaths: [],
      requestScope: null,
      contextSources: [],
    },
  };
}

function conversationTitleFromText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "New chat";
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

// Renders the visible transcript as a plain preamble so a freshly created
// session on a newly chosen model can pick up where the prior model left off.
// Only user and assistant turns are replayed; errors and tool chatter are skipped.
function serializeTranscriptForReseed(messages: AiPanelMessage[]): string {
  const turns = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`)
    .filter((line) => line.trim().length > 0);
  if (turns.length === 0) return "";
  return [
    "The conversation so far (continue it seamlessly; do not greet again or repeat this back):",
    turns.join("\n\n"),
  ].join("\n\n");
}

const chatTitleInstruction = [
  "You are naming a chat thread. Read the user's opening message and reply with a short,",
  "specific title of 2 to 5 words that captures what the chat is about.",
  "Reply with ONLY the title: plain text, no surrounding quotes, no trailing punctuation.",
  "",
  "Opening message:",
].join("\n");

function sanitizeChatTitle(raw: string): string {
  const firstLine = raw.trim().split(/\r?\n/)[0] ?? "";
  const cleaned = firstLine
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
}

/**
 * Asks the model for a short title in a throwaway session that has no tools, so it
 * can only reply with text. Best-effort: any failure returns null and the caller
 * keeps whatever title it already had. The scratch session is always cleaned up.
 */
async function requestGeneratedChatTitle(userMessage: string): Promise<string | null> {
  const message = userMessage.trim();
  if (!message) return null;
  let sessionId: string | null = null;
  try {
    const session = await createAgentSession({});
    sessionId = session.session_id;
    await sendAgentMessage(sessionId, {
      mode: "auto",
      user_message: `${chatTitleInstruction}\n${message}`,
      capabilities: { tools: [] },
    });
    const deadline = Date.now() + 20000;
    let after = 0;
    while (Date.now() < deadline) {
      const { events } = await fetchAgentEvents(sessionId, after);
      for (const event of events) {
        after = Math.max(after, event.sequence);
        if (event.type === "assistant_message" && event.text) return sanitizeChatTitle(event.text);
        if (event.type === "error") return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return null;
  } catch {
    return null;
  } finally {
    if (sessionId) void deleteAgentSession(sessionId).catch(() => undefined);
  }
}

function snapshotActiveConversation(
  set: (
    partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>),
  ) => void,
  get: () => AiSessionStore,
): void {
  const state = get();
  const id = state.activeConversationId;
  const existing = conversationSnapshots.get(id);
  const firstUserMessage = state.messages.find((message) => message.role === "user")?.text ?? "";
  // Once a conversation has a real title — auto-derived from its first message or
  // set by the person via rename — keep it, so a manual rename is never clobbered.
  const existingTitle = existing?.title ?? "";
  const hasRealTitle = existingTitle !== "" && existingTitle !== "New chat";
  const title = hasRealTitle
    ? existingTitle
    : firstUserMessage
      ? conversationTitleFromText(firstUserMessage)
      : existingTitle || "New chat";
  const updatedAt = Date.now();
  conversationSnapshots.set(id, {
    id,
    scopeKey: activeConversationScopeKey,
    title,
    updatedAt,
    createdAt: existing?.createdAt ?? updatedAt,
    status: state.status,
    mode: state.mode,
    messages: state.messages,
    plans: state.plans,
    toolApprovals: state.toolApprovals,
    error: state.error,
    transcriptLoaded: existing?.transcriptLoaded ?? true,
    modelId: activeAgentModelOverride ?? existing?.modelId,
    reasoningEffort: activeAgentReasoningOverride ?? existing?.reasoningEffort,
    runtime: {
      sessionId: activeSessionId,
      lastEventSequence,
      activeRoot,
      activeScopeId,
      activeSelectedPaths,
      requestScope: activeRequestScope,
      contextSources: activeContextSources,
    },
  });
  // Sync the title to the account when it changed, or when this snapshot is the first
  // to carry a server session id (e.g. a background rename set the title locally before
  // the session existed) so that title still reaches the server.
  const sessionJustAssigned = activeSessionId !== null && !existing?.runtime.sessionId;
  if (
    activeSessionId &&
    title !== "New chat" &&
    (title !== existing?.title || sessionJustAssigned)
  ) {
    void renameAgentSession(activeSessionId, title).catch(() => undefined);
  }
  set({
    conversations: state.conversations.map((conversation) =>
      conversation.id === id ? { ...conversation, id, title, updatedAt } : conversation,
    ),
  });
}

function agentSyncDeps(scopeKey = activeConversationScopeKey) {
  return {
    snapshots: conversationSnapshots,
    createSnapshot: (id: string, updatedAt: number) =>
      emptyStoredConversation(id, updatedAt, scopeKey),
    messageId: aiMessageId,
    debug: recordAiDebug,
  };
}

function applyConversationRuntime(snapshot: StoredConversation): void {
  agentRuntimeGeneration += 1;
  activeAgentModelOverride = snapshot.modelId ?? null;
  activeAgentReasoningOverride = snapshot.reasoningEffort ?? null;
  activeSessionId = snapshot.runtime.sessionId;
  lastEventSequence = snapshot.runtime.lastEventSequence;
  activeRoot = snapshot.runtime.activeRoot;
  activeScopeId = snapshot.runtime.activeScopeId;
  activeSelectedPaths = snapshot.runtime.activeSelectedPaths;
  activeRequestScope = snapshot.runtime.requestScope;
  activeContextSources = snapshot.runtime.contextSources;
  processedEventSequences.clear();
  processedToolRequestIds.clear();
  drainInFlight = null;
  abortRequested = false;
}

// Only one conversation is ever actively polling at a time. Switching away from a
// conversation with an in-flight response cancels it (like clicking Stop) before saving
// its state, rather than letting multiple conversations run concurrently in the
// background — that would risk a delayed event for conversation A landing in whichever
// conversation happens to be active by the time it arrives.
async function suspendActiveConversation(
  set: (
    partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>),
  ) => void,
  get: () => AiSessionStore,
): Promise<void> {
  const wasRunning = get().status?.running ?? false;
  snapshotActiveConversation(set, get);
  if (wasRunning) {
    await get().abortPrompt();
    const id = get().activeConversationId;
    const snapshot = conversationSnapshots.get(id);
    if (snapshot?.status?.running) {
      conversationSnapshots.set(id, {
        ...snapshot,
        status: { ...snapshot.status, running: false },
      });
    }
  }
}
const toolDefinitions = {
  list_directory: { name: "list_directory", risk: "read" },
  search_files: { name: "search_files", risk: "read" },
  preview_file: { name: "preview_file", risk: "read" },
  validate_file_plan: { name: "validate_file_plan", risk: "read" },
  apply_file_plan: { name: "apply_file_plan", risk: "write" },
} as const;

function toolManifestForScope(scope: AssistantScope | null): ToolManifest {
  const previewTools = mistyDocumentsEnabled() ? [toolDefinitions.preview_file] : [];
  if (scope === "files") {
    return {
      tools: [
        toolDefinitions.list_directory,
        toolDefinitions.validate_file_plan,
        toolDefinitions.apply_file_plan,
      ],
    };
  }
  if (scope === "cleanup") {
    return {
      tools: [
        toolDefinitions.list_directory,
        toolDefinitions.search_files,
        ...previewTools,
        toolDefinitions.validate_file_plan,
      ],
    };
  }
  if (scope === "search") {
    return {
      tools: [toolDefinitions.list_directory, toolDefinitions.search_files, ...previewTools],
    };
  }
  return { tools: [] };
}

function toolAllowedForScope(toolName: string, scope: AssistantScope): boolean {
  return toolManifestForScope(scope).tools.some((tool) => tool.name === toolName);
}

function classifyAssistantRequest(prompt: string): AssistantRequestScope {
  const normalized = prompt.toLowerCase();
  const matches: AssistantScope[] = [];
  if (
    /\b(clean(?:up)?|tidy|declutter|organize|duplicate|unused|large files?|old files?)\b/.test(
      normalized,
    )
  )
    matches.push("cleanup");
  if (
    /\b(search|find|locate|look for|where (?:is|are)|collections?|smart folder|query|tagged|tags?)\b/.test(
      normalized,
    )
  )
    matches.push("search");
  if (
    /\b(summar(?:y|ize)|compare|analy[sz]e|explain|extract|question|read|review|pdf|document|spreadsheet|presentation|slide|contract|report)\b/.test(
      normalized,
    )
  )
    matches.push("search");
  if (
    /\b(open|reveal|show in finder|copy|move|rename|create|make (?:a )?(?:file|folder)|transfer|download|upload)\b/.test(
      normalized,
    )
  )
    matches.push("files");
  const distinct = [...new Set(matches)];
  if (distinct.length > 1) return "ambiguous";
  return distinct[0] ?? null;
}

function isDocumentAssistantRequest(prompt: string): boolean {
  return /\b(summar(?:y|ize)|compare|analy[sz]e|explain|extract|question|read|review|pdf|document|spreadsheet|presentation|slide|contract|report)\b/i.test(
    prompt,
  );
}

function assistantScopeAllowed(
  preferences: ReturnType<typeof selectAssistantPreferences>,
  scope: AssistantScope,
): boolean {
  if (!preferences.enabled) return false;
  if (scope === "files") return preferences.scopes.filesAllowed;
  if (scope === "cleanup") return preferences.scopes.cleanupAllowed;
  return preferences.scopes.searchAllowed;
}

function scopedAssistantPrompt(prompt: string, scope: AssistantScope | null): string {
  if (scope === "cleanup") {
    return `${prompt}\n\nPermission boundary: Cleanup is enabled for scanning and planning only. Do not apply, move, rename, create, trash, delete, or otherwise modify files.`;
  }
  if (scope === "search") {
    return `${prompt}\n\nPermission boundary: Search is read-only. Search files, library metadata, tags, and paths, or suggest queries. Do not modify files or perform cleanup actions.`;
  }
  if (scope === "files") {
    return `${prompt}\n\nPermission boundary: Files actions are enabled. Stay within normal file operations and do not perform cleanup or search-only workflows.`;
  }
  return `${prompt}\n\nPermission boundary: No capability scope is active. Respond conversationally without using tools or modifying data.`;
}

function assistantScopeLabel(scope: AssistantScope): string {
  return scope[0].toUpperCase() + scope.slice(1);
}

function appendBlockedRequest(
  set: (
    partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>),
  ) => void,
  prompt: string,
  response: string,
): void {
  set((state) => ({
    error: null,
    status: statusWithRunning(state.status, false),
    messages: [
      ...state.messages,
      { id: aiMessageId("user"), role: "user", text: prompt },
      { id: aiMessageId("assistant"), role: "assistant", text: response },
    ],
  }));
}

export const useAgentSessionStore = create<AiSessionStore>((set, get) => ({
  status: serverStatus(false),
  mode: "auto",
  messages: [],
  plans: [],
  toolApprovals: [],
  error: null,
  conversations: [
    { id: initialConversationId, title: "New chat", updatedAt: Date.now(), createdAt: Date.now() },
  ],
  activeConversationId: initialConversationId,
  conversationScopeKey: filesAgentScopeKey,
  activeModelId: "",
  activeReasoningEffort: "",

  refreshStatus: async () => {
    const generation = agentRuntimeGeneration;
    try {
      const status = await fetchAgentStatus();
      if (!agentRuntimeIsCurrent(generation)) return;
      set({ status: serverStatusFromResponse(status), error: status.error });
    } catch (error) {
      if (!agentRuntimeIsCurrent(generation)) return;
      const message = errorText(error);
      recordAiDebug("error", "Agent status check failed.", message);
      set({ status: serverStatus(false, message, false), error: message });
    }
  },

  setMode: (mode) => {
    set({ mode: mode === "full" ? "auto" : mode });
  },

  setConversationModel: async (modelId, { resend }) => {
    const nextModelId = modelId.trim();
    if (!nextModelId || get().status?.running) return;
    const conversationId = get().activeConversationId;
    if (nextModelId === (get().activeModelId || "")) return;
    // Repin this chat only. The agent's saved model is never written here.
    activeAgentModelOverride = nextModelId;
    // A server session is locked to the model it was created with, so switching
    // means abandoning the old one and opening a fresh session on the new model at
    // the next send. The old session is deleted so it can't resurface on hydrate.
    const priorSessionId = activeSessionId;
    resetActiveSession();
    stopAiPolling();
    if (priorSessionId) void deleteAgentSession(priorSessionId).catch(() => undefined);
    const existing = conversationSnapshots.get(conversationId);
    const clearedRuntime = existing
      ? { ...existing.runtime, sessionId: null, lastEventSequence: 0 }
      : undefined;
    if (resend) {
      // Keep the visible history; the next send replays it to the new model. This
      // is the costly path, which the UI warns about before choosing it.
      pendingReseedConversationIds.add(conversationId);
      if (existing && clearedRuntime) {
        conversationSnapshots.set(conversationId, {
          ...existing,
          modelId: nextModelId,
          runtime: clearedRuntime,
        });
      }
      set({ activeModelId: nextModelId, error: null });
    } else {
      // Reset: start this chat fresh on the new model with no history to resend.
      pendingReseedConversationIds.delete(conversationId);
      if (existing && clearedRuntime) {
        conversationSnapshots.set(conversationId, {
          ...existing,
          modelId: nextModelId,
          messages: [],
          plans: [],
          toolApprovals: [],
          transcriptLoaded: true,
          runtime: clearedRuntime,
        });
      }
      set({
        activeModelId: nextModelId,
        messages: [],
        plans: [],
        toolApprovals: [],
        error: null,
        status: serverStatus(false),
      });
    }
  },

  setConversationReasoning: async (effort) => {
    const nextEffort = effort.trim();
    if (get().status?.running) return;
    const conversationId = get().activeConversationId;
    if (nextEffort === (get().activeReasoningEffort || "")) return;
    // Repin this chat's effort only; the agent's saved default is never written here.
    activeAgentReasoningOverride = nextEffort || null;
    const existing = conversationSnapshots.get(conversationId);
    const priorSessionId = activeSessionId;
    if (priorSessionId) {
      // A server session is created with a fixed effort, so switching means opening a
      // fresh session on the next send. History is kept and replayed for continuity.
      resetActiveSession();
      stopAiPolling();
      void deleteAgentSession(priorSessionId).catch(() => undefined);
      const clearedRuntime = existing
        ? { ...existing.runtime, sessionId: null, lastEventSequence: 0 }
        : undefined;
      if (get().messages.length > 0) pendingReseedConversationIds.add(conversationId);
      if (existing && clearedRuntime) {
        conversationSnapshots.set(conversationId, {
          ...existing,
          reasoningEffort: nextEffort,
          runtime: clearedRuntime,
        });
      }
    } else if (existing) {
      conversationSnapshots.set(conversationId, { ...existing, reasoningEffort: nextEffort });
    }
    set({ activeReasoningEffort: nextEffort, error: null });
  },

  sendPrompt: async ({ displayPrompt, prompt, cwd, selectedPaths, contextSources }) => {
    const trimmed = displayPrompt.trim();
    if (!trimmed || get().status?.running) return;
    const generation = agentRuntimeGeneration;
    const conversationId = get().activeConversationId;
    // When this chat's model was just switched with history kept, replay the
    // prior transcript to the new model on this first turn so it has full context.
    const reseedTranscript = pendingReseedConversationIds.has(conversationId)
      ? serializeTranscriptForReseed(get().messages)
      : "";
    const settingsStore = useSettingsStore.getState();
    if (!settingsStore.loaded) await settingsStore.load();
    if (!agentRuntimeIsCurrent(generation) || conversationId !== get().activeConversationId) return;
    const preferences = selectAssistantPreferences(useSettingsStore.getState().settings?.document);
    if (!preferences.enabled) {
      appendBlockedRequest(
        set,
        trimmed,
        "Agents are disabled. Enable Agents in Settings to continue.",
      );
      return;
    }
    const inSpace = activeConversationScopeKey !== filesAgentScopeKey;
    if (inSpace && !get().status?.spaceScopedSessions) {
      appendBlockedRequest(
        set,
        trimmed,
        "Private Space Agents are unavailable because this Misty server does not support permission-checked Space sessions yet.",
      );
      return;
    }
    if (!inSpace && isDocumentAssistantRequest(trimmed) && !mistyDocumentsEnabled()) {
      appendBlockedRequest(
        set,
        trimmed,
        "Misty document intelligence is not enabled for this rollout.",
      );
      return;
    }
    const classifiedScope = inSpace ? null : classifyAssistantRequest(trimmed);
    if (classifiedScope === "ambiguous") {
      appendBlockedRequest(
        set,
        trimmed,
        "That request crosses more than one permission scope. Please split it into separate Files, Cleanup, or Search steps.",
      );
      return;
    }
    // A reply with no scope keywords of its own (e.g. answering "which folder?" with a
    // bare path) continues whatever scope this conversation already established, instead
    // of dropping to no-tool-access and causing the model to attempt a now-disallowed
    // tool call as it continues its own train of thought from the previous turn.
    const requestScope = classifiedScope ?? activeRequestScope;
    if (requestScope && !assistantScopeAllowed(preferences, requestScope)) {
      appendBlockedRequest(
        set,
        trimmed,
        `The ${assistantScopeLabel(requestScope)} scope is disabled. Allow it in Settings > Assistant to continue.`,
      );
      return;
    }
    activeRoot = cwd || null;
    activeSelectedPaths = selectedPaths ?? [];
    activeRequestScope = requestScope;
    activeContextSources = contextSources ?? [];
    abortRequested = false;
    // The opening message of an untitled agent chat is a good moment to let the model
    // name the thread. Runs in the background so it never delays the reply, and only
    // for agent chats that still carry the default title.
    const isFirstUserMessage = !get().messages.some((message) => message.role === "user");
    const currentTitle = get().conversations.find((c) => c.id === conversationId)?.title;
    if (
      isFirstUserMessage &&
      (currentTitle === undefined || currentTitle === "New chat") &&
      parseAgentScopeKey(activeConversationScopeKey) !== null
    ) {
      void requestGeneratedChatTitle(trimmed).then((title) => {
        if (title) void get().renameConversation(conversationId, title);
      });
    }
    set((state) => ({
      messages: [...state.messages, { id: aiMessageId("user"), role: "user", text: trimmed }],
      error: null,
      status: statusWithRunning(state.status, true),
    }));
    try {
      await ensureSession(generation);
      assertAgentRuntime(generation);
      const registeredScope = cwd
        ? await agentsRegisterFolderScope({ path: cwd }).catch(() => null)
        : null;
      assertAgentRuntime(generation);
      activeScopeId = registeredScope?.id ?? null;
      const serverContext = agentServerContext(
        cwd,
        selectedPaths ?? [],
        registeredScope?.id ?? null,
      );
      const outboundPrompt = reseedTranscript ? `${reseedTranscript}\n\n${prompt}` : prompt;
      await sendAgentMessageOnce(
        {
          mode: get().mode,
          user_message: scopedAssistantPrompt(outboundPrompt, requestScope),
          active_root: serverContext.activeRoot,
          selected_paths: serverContext.selectedPaths,
          capabilities: toolManifestForScope(requestScope),
          space_id: inSpace ? activeSpaceIdFromScopeKey(activeConversationScopeKey) : undefined,
        },
        generation,
      );
      if (reseedTranscript) pendingReseedConversationIds.delete(conversationId);
      assertAgentRuntime(generation);
      ensureAiPolling(set, get);
      await drainAiEvents(set, get);
    } catch (error) {
      if (error instanceof AgentRuntimeChangedError || !agentRuntimeIsCurrent(generation)) return;
      stopAiPolling();
      const message = errorText(error);
      if (abortRequested && message.toLowerCase().includes("canceled")) {
        resetActiveSession();
        set((state) => ({ error: null, status: statusWithRunning(state.status, false) }));
        return;
      }
      recordAiDebug("error", "Agent send failed.", message);
      set((state) => ({
        error: message,
        status: statusWithRunning(state.status, false, message),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  approveToolRequest: async (requestId) => {
    const sessionId = activeSessionId;
    const generation = agentRuntimeGeneration;
    const approval = get().toolApprovals.find((candidate) => candidate.id === requestId);
    if (!sessionId || !approval || approval.running || approval.completed) return;
    set((state) => ({
      status: statusWithRunning(state.status, true),
      toolApprovals: state.toolApprovals.map((candidate) =>
        candidate.id === requestId ? { ...candidate, running: true, error: null } : candidate,
      ),
    }));
    try {
      const result = await runToolRequest(approval.request, approval.scope);
      assertAgentRuntime(generation, sessionId);
      await submitToolResults(sessionId, [result]);
      assertAgentRuntime(generation, sessionId);
      set((state) => ({
        toolApprovals: state.toolApprovals.map((candidate) =>
          candidate.id === requestId
            ? {
                ...candidate,
                running: false,
                completed: true,
                error: result.ok ? null : (result.error ?? "Tool failed"),
              }
            : candidate,
        ),
      }));
      ensureAiPolling(set, get);
      await drainAiEvents(set, get);
    } catch (error) {
      if (error instanceof AgentRuntimeChangedError || !agentRuntimeIsCurrent(generation, sessionId))
        return;
      const message = errorText(error);
      recordAiDebug("error", "Agent approved tool failed.", message);
      set((state) => ({
        error: message,
        status: statusWithRunning(state.status, false, message),
        toolApprovals: state.toolApprovals.map((candidate) =>
          candidate.id === requestId ? { ...candidate, running: false, error: message } : candidate,
        ),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  approvePlan: async (planId) => {
    const generation = agentRuntimeGeneration;
    const plan = get().plans.find((candidate) => candidate.id === planId);
    if (!plan || plan.applied || plan.applying) return;
    const blockedReasons =
      plan.scope !== "files"
        ? [
            plan.scope === "cleanup"
              ? "Cleanup plans are review-only in V1."
              : "The Files scope is required to apply this plan.",
          ]
        : validateClientPlan(plan.plan);
    if (blockedReasons.length > 0) {
      set((state) => ({
        plans: state.plans.map((candidate) =>
          candidate.id === planId ? { ...candidate, blockedReasons } : candidate,
        ),
        messages: [
          ...state.messages,
          {
            id: aiMessageId("error"),
            role: "error",
            text: `Plan blocked: ${blockedReasons.join("; ")}`,
          },
        ],
      }));
      return;
    }
    set((state) => ({
      plans: state.plans.map((candidate) =>
        candidate.id === planId ? { ...candidate, applying: true, blockedReasons: [] } : candidate,
      ),
    }));
    try {
      await applyFilePlan(plan.plan);
      assertAgentRuntime(generation);
      const appliedSummary = queuedSummaryForPlan(plan.plan);
      set((state) => ({
        plans: state.plans.map((candidate) =>
          candidate.id === planId
            ? { ...candidate, applied: true, applying: false, appliedSummary }
            : candidate,
        ),
        messages: [
          ...state.messages,
          { id: aiMessageId("assistant"), role: "assistant", text: appliedSummary },
        ],
      }));
    } catch (error) {
      if (error instanceof AgentRuntimeChangedError || !agentRuntimeIsCurrent(generation)) return;
      const message = errorText(error);
      set((state) => ({
        error: message,
        plans: state.plans.map((candidate) =>
          candidate.id === planId
            ? { ...candidate, applying: false, blockedReasons: [message] }
            : candidate,
        ),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  abortPrompt: async () => {
    const generation = agentRuntimeGeneration;
    const sessionId = activeSessionId;
    abortRequested = true;
    try {
      if (sessionId) await cancelAgentSession(sessionId);
    } catch (error) {
      if (agentRuntimeIsCurrent(generation, sessionId)) set({ error: errorText(error) });
    } finally {
      if (!agentRuntimeIsCurrent(generation, sessionId)) return;
      stopAiPolling();
      drainInFlight = null;
      resetActiveSession();
      set((state) => ({ status: statusWithRunning(state.status, false) }));
    }
  },

  clearConversation: () => {
    const sessionId = activeSessionId;
    if (sessionId)
      void deleteAgentSession(sessionId).catch((error) => {
        recordAiDebug("warn", "Agent conversation deletion failed.", errorText(error));
      });
    stopAiPolling();
    activeSessionId = null;
    lastEventSequence = 0;
    drainInFlight = null;
    processedEventSequences.clear();
    processedToolRequestIds.clear();
    activeRequestScope = null;
    activeRoot = null;
    activeScopeId = null;
    activeSelectedPaths = [];
    activeContextSources = [];
    set({ messages: [], plans: [], toolApprovals: [], error: null, status: serverStatus(false) });
  },

  activateConversationScope: async (scopeKey) => {
    const nextScopeKey = scopeKey.trim() || filesAgentScopeKey;
    const generation = ++scopeActivationGeneration;
    if (nextScopeKey === activeConversationScopeKey) return;
    await suspendActiveConversation(set, get);
    if (generation !== scopeActivationGeneration) return;
    activeConversationScopeKey = nextScopeKey;
    // Agent chats live on the account (tagged with the session's agent/space).
    // Pull any that this device hasn't seen so restored chats are chosen over a
    // throwaway empty conversation. Failures leave the in-memory list authoritative.
    const agentScope = parseAgentScopeKey(nextScopeKey);
    if (agentScope?.agentId) {
      await hydrateServerSessions(
        agentSyncDeps(nextScopeKey),
        (session) =>
          session.agent_id === agentScope.agentId &&
          (session.space_id ?? "") === (agentScope.spaceId ?? ""),
      );
      if (generation !== scopeActivationGeneration) return;
    }
    const candidates = [...conversationSnapshots.values()]
      .filter((conversation) => conversation.scopeKey === nextScopeKey)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const target = candidates[0] ?? emptyStoredConversation(newConversationId(), Date.now());
    if (!conversationSnapshots.has(target.id)) conversationSnapshots.set(target.id, target);
    applyConversationRuntime(target);
    set({
      activeConversationId: target.id,
      conversationScopeKey: nextScopeKey,
      activeModelId: target.modelId ?? "",
      activeReasoningEffort: target.reasoningEffort ?? "",
      status: target.status,
      mode: target.mode,
      messages: target.messages,
      plans: target.plans,
      toolApprovals: target.toolApprovals,
      error: target.error,
      conversations: candidates.length
        ? candidates.map(({ id, title, updatedAt, createdAt }) => ({
            id,
            title,
            updatedAt,
            createdAt,
          }))
        : [
            {
              id: target.id,
              title: target.title,
              updatedAt: target.updatedAt,
              createdAt: target.createdAt,
            },
          ],
    });
  },

  startNewConversation: async () => {
    await suspendActiveConversation(set, get);
    const id = newConversationId();
    const now = Date.now();
    const fresh = emptyStoredConversation(id, now, activeConversationScopeKey);
    conversationSnapshots.set(id, fresh);
    applyConversationRuntime(fresh);
    set((state) => ({
      activeConversationId: id,
      activeModelId: fresh.modelId ?? "",
      activeReasoningEffort: fresh.reasoningEffort ?? "",
      status: fresh.status,
      mode: fresh.mode,
      messages: fresh.messages,
      plans: fresh.plans,
      toolApprovals: fresh.toolApprovals,
      error: fresh.error,
      conversations: [
        ...state.conversations,
        { id, title: fresh.title, updatedAt: now, createdAt: fresh.createdAt },
      ],
    }));
  },

  switchConversation: async (id) => {
    if (id === get().activeConversationId) return;
    const target = conversationSnapshots.get(id);
    if (!target || target.scopeKey !== activeConversationScopeKey) return;
    await suspendActiveConversation(set, get);
    applyConversationRuntime(target);
    set({
      activeConversationId: id,
      activeModelId: target.modelId ?? "",
      activeReasoningEffort: target.reasoningEffort ?? "",
      status: target.status,
      mode: target.mode,
      messages: target.messages,
      plans: target.plans,
      toolApprovals: target.toolApprovals,
      error: target.error,
    });
    if (target.runtime.sessionId && !target.transcriptLoaded) {
      await loadConversationTranscript(
        id,
        target.runtime.sessionId,
        agentSyncDeps(),
        (messages) => set({ messages }),
        () => get().activeConversationId,
      );
    }
  },

  renameConversation: async (id, title) => {
    const next = title.trim();
    const snapshot = conversationSnapshots.get(id);
    if (!next || !snapshot || next === snapshot.title) return;
    const updatedAt = Date.now();
    conversationSnapshots.set(id, { ...snapshot, title: next, updatedAt });
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, title: next, updatedAt } : conversation,
      ),
    }));
    // Persist to the account so the rename survives reloads and reaches other devices.
    // For the active chat the live session id may not be written into the snapshot yet
    // (that happens on suspend), so fall back to the running session.
    const sessionId =
      snapshot.runtime.sessionId ??
      (id === get().activeConversationId ? activeSessionId : null);
    if (sessionId) {
      await renameAgentSession(sessionId, next).catch((error: unknown) =>
        recordAiDebug("warn", "Agent chat rename could not be saved.", errorText(error)),
      );
    }
  },

  hydrateConversations: async () => {
    // The current server session schema has no Space scope metadata. Hydrating
    // an unlabelled server session into a Space could expose another Space's
    // private conversation, so only the Files scope may import legacy rows.
    if (activeConversationScopeKey !== filesAgentScopeKey) return;
    const generation = agentRuntimeGeneration;
    const added = await hydrateServerSessions(
      agentSyncDeps(),
      (session) => !session.agent_id && !session.space_id,
    );
    if (!agentRuntimeIsCurrent(generation) || activeConversationScopeKey !== filesAgentScopeKey)
      return;
    if (added.length === 0) return;
    set((state) => ({
      conversations: [...state.conversations, ...added].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
    }));
  },

  deleteConversationSession: async (id) => {
    const current = get();
    const isActive = id === current.activeConversationId;
    if (isActive) await suspendActiveConversation(set, get);
    const sessionIdToDelete = conversationSnapshots.get(id)?.runtime.sessionId ?? null;
    conversationSnapshots.delete(id);
    if (sessionIdToDelete) void deleteAgentSession(sessionIdToDelete).catch(() => undefined);
    const remaining = current.conversations.filter((conversation) => conversation.id !== id);
    if (!isActive) {
      set({ conversations: remaining });
      return;
    }
    const next = remaining[0];
    const target = next ? conversationSnapshots.get(next.id) : null;
    if (next && target) {
      applyConversationRuntime(target);
      set({
        activeConversationId: next.id,
        activeModelId: target.modelId ?? "",
      activeReasoningEffort: target.reasoningEffort ?? "",
        status: target.status,
        mode: target.mode,
        messages: target.messages,
        plans: target.plans,
        toolApprovals: target.toolApprovals,
        error: target.error,
        conversations: remaining,
      });
      return;
    }
    set({ conversations: remaining });
    await get().startNewConversation();
  },
}));

export function resetAgentAccountState(): void {
  stopAiPolling();
  resetActiveSession();
  activeRoot = null;
  conversationSnapshots.clear();
  scopeActivationGeneration += 1;
  activeConversationScopeKey = filesAgentScopeKey;
  activeContextSources = [];
  activeAgentModelOverride = null;
  activeAgentReasoningOverride = null;
  pendingReseedConversationIds.clear();
  const freshId = newConversationId();
  useAgentSessionStore.setState({
    status: serverStatus(false),
    mode: "auto",
    messages: [],
    plans: [],
    toolApprovals: [],
    error: null,
    conversations: [
      { id: freshId, title: "New chat", updatedAt: Date.now(), createdAt: Date.now() },
    ],
    activeConversationId: freshId,
    conversationScopeKey: filesAgentScopeKey,
    activeModelId: "",
    activeReasoningEffort: "",
  });
}

function ensureAiPolling(
  set: (
    partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>),
  ) => void,
  get: () => AiSessionStore,
): void {
  if (pollTimer !== null || typeof window === "undefined") return;
  pollTimer = window.setInterval(() => {
    const generation = agentRuntimeGeneration;
    void drainAiEvents(set, get).catch((error) => {
      if (error instanceof AgentRuntimeChangedError || !agentRuntimeIsCurrent(generation)) return;
      const message = errorText(error);
      recordAiDebug("error", "Agent polling failed.", message);
      stopAiPolling();
      set((state) => ({
        error: message,
        status: statusWithRunning(state.status, false, message),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    });
  }, 900);
}

async function drainAiEvents(
  set: (
    partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>),
  ) => void,
  get: () => AiSessionStore,
): Promise<void> {
  if (drainInFlight) return drainInFlight;
  const generation = agentRuntimeGeneration;
  const sessionId = activeSessionId;
  if (!sessionId) return;
  const task = drainAiEventsOnce(set, get, generation, sessionId);
  drainInFlight = task;
  try {
    await task;
  } finally {
    if (drainInFlight === task) drainInFlight = null;
  }
}

async function drainAiEventsOnce(
  set: (
    partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>),
  ) => void,
  get: () => AiSessionStore,
  generation: number,
  sessionId: string,
): Promise<void> {
  if (!agentRuntimeIsCurrent(generation, sessionId)) return;
  const afterSequence = lastEventSequence;
  const { events } = await fetchAgentEvents(sessionId, afterSequence);
  if (!agentRuntimeIsCurrent(generation, sessionId)) return;
  const nextEvents = events.filter((event) => {
    if (event.sequence <= lastEventSequence) return false;
    if (processedEventSequences.has(event.sequence)) return false;
    processedEventSequences.add(event.sequence);
    return true;
  });
  recordAiDebug(
    "info",
    "Fetched agent events.",
    `session=${sessionId} count=${events.length} new=${nextEvents.length} after=${afterSequence}`,
  );
  if (nextEvents.length === 0) {
    await settleEmptyEventPoll(set, generation, sessionId);
    return;
  }

  const toolResults: ToolResult[] = [];
  const nextMessages: AiPanelMessage[] = [];
  const nextPlans: AiPlanReview[] = [];
  const nextToolApprovals: AiToolApproval[] = [];
  for (const event of nextEvents) {
    lastEventSequence = Math.max(lastEventSequence, event.sequence);
    if (event.type === "assistant_message" && event.text) {
      nextMessages.push({
        id: aiMessageId("assistant"),
        role: "assistant",
        text: event.text,
        citations: event.citations,
        contextSources: activeContextSources,
        hostedAiUsedRatio: event.hosted_ai_used_ratio,
        hostedAiResetAt: event.hosted_ai_reset_at,
      });
    } else if (event.type === "error" && event.message) {
      nextMessages.push({ id: aiMessageId("error"), role: "error", text: event.message });
    } else if (event.type === "tool_request") {
      for (const request of event.tool_requests ?? []) {
        if (processedToolRequestIds.has(request.id)) continue;
        processedToolRequestIds.add(request.id);
        nextMessages.push({
          id: aiMessageId("tool"),
          role: "tool",
          toolRequestId:
            request.approval_required && get().mode !== "full" ? request.id : undefined,
          text: request.approval_required
            ? `Approval required: ${request.name}`
            : `Running ${request.name}`,
        });
        if (!request.approval_required || get().mode === "full") {
          recordAiDebug("info", "Running agent tool request.", `${request.name} ${request.id}`);
          toolResults.push(await runToolRequestWithTimeout(request, activeRequestScope));
          if (!agentRuntimeIsCurrent(generation, sessionId)) return;
        } else {
          nextToolApprovals.push({
            id: request.id,
            request,
            running: false,
            completed: false,
            error: null,
            scope: activeRequestScope,
          });
        }
      }
    } else if (event.type === "file_plan" && event.file_plan) {
      const planId = `plan-${Date.now()}-${nextPlanId++}`;
      const blockedReasons =
        activeRequestScope === "cleanup"
          ? ["Cleanup plans are review-only in V1."]
          : activeRequestScope === "files"
            ? validateClientPlan(event.file_plan)
            : ["The Files scope is required to apply this plan."];
      nextPlans.push({
        id: planId,
        plan: event.file_plan,
        applied: false,
        applying: false,
        appliedSummary: null,
        blockedReasons,
        scope: activeRequestScope,
      });
      nextMessages.push({
        id: aiMessageId("plan"),
        role: "plan",
        planId,
        text: planSummary(event.file_plan, blockedReasons),
      });
    }
  }
  if (!agentRuntimeIsCurrent(generation, sessionId)) return;
  set((state) => ({
    messages: [...state.messages, ...nextMessages],
    plans: [...state.plans, ...nextPlans],
    toolApprovals: [...state.toolApprovals, ...nextToolApprovals],
    status: statusWithRunning(state.status, toolResults.length > 0),
  }));
  if (toolResults.length > 0) {
    await submitToolResults(sessionId, toolResults);
    if (!agentRuntimeIsCurrent(generation, sessionId)) return;
    await drainAiEventsOnce(set, get, generation, sessionId);
    return;
  }
  await settleEmptyEventPoll(set, generation, sessionId);
}

async function settleEmptyEventPoll(
  set: (
    partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>),
  ) => void,
  generation: number,
  sessionId: string,
): Promise<void> {
  if (!agentRuntimeIsCurrent(generation, sessionId)) return;
  try {
    const status = await fetchAgentStatus();
    if (!agentRuntimeIsCurrent(generation, sessionId)) return;
    if (status.running) {
      set({ status: serverStatusFromResponse(status) });
      ensureAiPolling(set, useAgentSessionStore.getState);
      return;
    }
    set({ status: serverStatusFromResponse(status) });
  } catch {
    if (!agentRuntimeIsCurrent(generation, sessionId)) return;
    set({ status: serverStatus(false) });
  }
  stopAiPolling();
}

function stopAiPolling(): void {
  if (pollTimer === null || typeof window === "undefined") return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

async function ensureSession(generation = agentRuntimeGeneration): Promise<string> {
  assertAgentRuntime(generation);
  if (activeSessionId) return activeSessionId;
  const scopeKey = activeConversationScopeKey;
  const agentScope = parseAgentScopeKey(scopeKey);
  const sessionInput = agentScope ?? {
    spaceId: scopeKey === filesAgentScopeKey ? undefined : activeSpaceIdFromScopeKey(scopeKey),
  };
  // A per-chat model override wins over the agent's configured model. The server
  // treats a supplied model_id as this session's model without touching the agent.
  if (activeAgentModelOverride) sessionInput.modelId = activeAgentModelOverride;
  if (!sessionInput.agentId && !sessionInput.modelId) sessionInput.modelId = initialAgentModelId;
  // A per-chat effort override wins over the agent's configured effort for this session.
  if (activeAgentReasoningOverride) sessionInput.reasoningEffort = activeAgentReasoningOverride;
  const session = await createAgentSession(sessionInput);
  assertAgentRuntime(generation);
  if (scopeKey !== activeConversationScopeKey) throw new AgentRuntimeChangedError();
  activeSessionId = session.session_id;
  lastEventSequence = 0;
  recordAiDebug("info", "Created agent session.", activeSessionId);
  return activeSessionId;
}

function parseAgentScopeKey(
  scopeKey: string,
): { agentId?: string; spaceId?: string; modelId?: string; reasoningEffort?: string } | null {
  const marker = ":agents?";
  const offset = scopeKey.indexOf(marker);
  if (offset < 0) return null;
  const params = new URLSearchParams(scopeKey.slice(offset + marker.length));
  return {
    agentId: params.get("agent") || undefined,
    spaceId: params.get("space") || undefined,
    modelId: params.get("model") || undefined,
  };
}

async function sendAgentMessageOnce(
  body: Parameters<typeof sendAgentMessage>[1],
  generation = agentRuntimeGeneration,
): Promise<void> {
  const sessionId = await ensureSession(generation);
  assertAgentRuntime(generation, sessionId);
  recordAiDebug(
    "info",
    "Sending message to the agent server.",
    `session=${sessionId} cwd=${activeRoot ?? ""}`,
  );
  try {
    await sendAgentMessage(sessionId, body);
    assertAgentRuntime(generation, sessionId);
  } catch (error) {
    assertAgentRuntime(generation, sessionId);
    if (isSessionNotFoundError(error)) {
      resetActiveSession(false);
      throw new Error(
        "Agent session expired. Your request was not resent. Send it again to continue.",
      );
    }
    throw error;
  }
}

function resetActiveSession(invalidateRuntime = true): void {
  if (invalidateRuntime) agentRuntimeGeneration += 1;
  activeSessionId = null;
  lastEventSequence = 0;
  drainInFlight = null;
  processedEventSequences.clear();
  processedToolRequestIds.clear();
  activeRequestScope = null;
  activeScopeId = null;
  activeSelectedPaths = [];
}

function isSessionNotFoundError(error: unknown): boolean {
  return errorText(error).toLowerCase().includes("session not found");
}

async function runToolRequest(
  request: ToolRequest,
  scope: AssistantScope | null,
): Promise<ToolResult> {
  try {
    const preferences = selectAssistantPreferences(useSettingsStore.getState().settings?.document);
    if (!scope || !assistantScopeAllowed(preferences, scope)) {
      return toolError(
        request,
        scope
          ? `The ${assistantScopeLabel(scope)} scope is disabled.`
          : "This request has no allowed capability scope.",
      );
    }
    if (!toolAllowedForScope(request.name, scope)) {
      return toolError(
        request,
        `${request.name} is not allowed by the ${assistantScopeLabel(scope)} scope.`,
      );
    }
    const args = toolArgs(request);
    switch (request.name) {
      case "list_directory": {
        const requestedPath = stringArg(args.path);
        const directoryPath =
          !requestedPath || requestedPath === "." || requestedPath === activeScopeId
            ? activeRoot
            : isSafeRelativePath(requestedPath)
              ? absoluteFromRelative(requestedPath)
              : null;
        if (!directoryPath)
          return toolError(
            request,
            "list_directory requires a path relative to the active agent scope.",
          );
        const listing = await explorerListDirectory({ path: directoryPath });
        return toolOK(request, {
          path: activeRoot ? (deviceRelativePath(activeRoot, listing.path) ?? ".") : ".",
          entries: listing.entries.map((entry) => ({
            name: entry.name,
            path: relativeToRoot(entry.path),
            kind: entry.kind,
            extension: entry.extension,
            sizeBytes: entry.sizeBytes,
            modifiedMs: entry.modifiedMs,
            hidden: entry.hidden,
          })),
        });
      }
      case "search_files": {
        const results = await searchQuery({
          query: stringArg(args.query),
          currentPath: activeRoot,
          scope: "current",
          limit: numberArg(args.limit) ?? 50,
        });
        return toolOK(request, {
          results: results.flatMap((result) => {
            const path = activeRoot ? deviceRelativePath(activeRoot, result.entry.path) : null;
            if (!path) return [];
            return [
              {
                name: result.entry.name,
                path,
                kind: result.entry.kind,
                extension: result.entry.extension,
                sizeBytes: result.entry.sizeBytes,
                modifiedMs: result.entry.modifiedMs,
                score: result.score,
                match: result.match,
              },
            ];
          }),
        });
      }
      case "preview_file": {
        const requested = stringArg(args.path);
        if (requested && !isSafeRelativePath(requested)) {
          return toolError(
            request,
            "preview_file requires a path relative to the active agent scope.",
          );
        }
        const candidate = requested ? absoluteFromRelative(requested) : activeSelectedPaths[0];
        if (!candidate)
          return toolError(request, "Select a document or provide a path to preview_file.");
        if (activeRoot && !deviceRelativePath(activeRoot, candidate)) {
          return toolError(request, "The document is outside the active agent scope.");
        }
        const document = await agentsPrepareDocument({ path: candidate });
        const scope = activeRoot ? await agentsRegisterFolderScope({ path: activeRoot }) : null;
        return toolOK(request, {
          documentId: document.documentId,
          fileName: document.displayName,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          scopeId: scope?.id ?? "",
          relativePath: relativeToRoot(candidate),
          sections: document.sections,
          truncated: document.truncated,
          citationRule:
            "Cite every factual document claim using the supplied scopeId, relativePath, fileName, section kind, and locator.",
        });
      }
      case "validate_file_plan": {
        const plan = args.plan as FileOperationPlan | undefined;
        const problems = plan ? validateClientPlan(plan) : ["plan is required"];
        return toolOK(request, { ok: problems.length === 0, problems });
      }
      case "apply_file_plan": {
        const plan = args.plan as FileOperationPlan | undefined;
        if (!plan) return toolError(request, "plan is required");
        const problems = validateClientPlan(plan);
        if (problems.length > 0) return toolOK(request, { ok: false, problems });
        await applyFilePlan(plan);
        return toolOK(request, { ok: true });
      }
      default:
        return toolError(request, `Unsupported tool: ${request.name}`);
    }
  } catch (error) {
    return toolError(request, errorText(error));
  }
}

async function runToolRequestWithTimeout(
  request: ToolRequest,
  scope: AssistantScope | null,
): Promise<ToolResult> {
  let timeoutId: number | null = null;
  try {
    const timeoutMs = request.name === "preview_file" ? 60_000 : aiToolTimeoutMs;
    return await Promise.race([
      runToolRequest(request, scope),
      new Promise<ToolResult>((resolve) => {
        timeoutId = window.setTimeout(() => {
          resolve(
            toolError(
              request,
              `${request.name} timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

async function applyFilePlan(plan: FileOperationPlan): Promise<void> {
  const root = activeRoot;
  if (!root) throw new Error("No active root is available for this file plan.");
  await preparePlanFolders(plan);
  for (const operation of plan.operations) {
    if (operation.type === "mkdir") {
      continue;
    } else if (operation.type === "rename") {
      const from = absoluteFromRelative(operation.from);
      const to = absoluteFromRelative(operation.to);
      if (dirname(from) === dirname(to)) {
        await explorerQueueRenameItem({ path: from, newName: basename(to) });
      } else {
        await explorerQueuePasteItems({
          sources: [{ path: from, isDirectory: false }],
          destinationDirectory: dirname(to),
          operation: "move",
          targetName: basename(to),
        });
      }
    } else if (operation.type === "move") {
      const from = absoluteFromRelative(operation.from);
      const to = absoluteFromRelative(operation.to);
      await explorerQueuePasteItems({
        sources: [{ path: from, isDirectory: false }],
        destinationDirectory: dirname(to),
        operation: "move",
        targetName: basename(to),
      });
    }
  }
}

async function preparePlanFolders(plan: FileOperationPlan): Promise<void> {
  const folderPaths = new Set<string>();
  for (const operation of plan.operations) {
    if (operation.type === "mkdir" && safeRelativePath(operation.path)) {
      folderPaths.add(cleanRelativePath(operation.path));
    }
  }
  const orderedFolders = [...folderPaths].sort(
    (left, right) => left.split("/").length - right.split("/").length,
  );
  for (const relativeFolder of orderedFolders) {
    const target = absoluteFromRelative(relativeFolder);
    try {
      await explorerCreateItem({
        directory: dirname(target),
        name: basename(target),
        kind: "folder",
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return errorText(error).toLowerCase().includes("already exists");
}

function validateClientPlan(plan: FileOperationPlan): string[] {
  const problems: string[] = [];
  const destinations = new Set<string>();
  if (!plan.summary?.trim()) problems.push("summary is required");
  if (!Array.isArray(plan.operations) || plan.operations.length === 0)
    problems.push("at least one operation is required");
  for (const [index, operation] of plan.operations.entries()) {
    const prefix = `operations[${index}]`;
    if (operation.type === "mkdir") {
      if (!safeRelativePath(operation.path))
        problems.push(`${prefix}: mkdir path must be relative and safe`);
      else destinations.add(cleanRelativePath(operation.path));
    } else if (operation.type === "move" || operation.type === "rename") {
      if (!safeRelativePath(operation.from))
        problems.push(`${prefix}: source must be relative and safe`);
      if (!safeRelativePath(operation.to))
        problems.push(`${prefix}: destination must be relative and safe`);
      const to = cleanRelativePath(operation.to);
      if (to && destinations.has(to)) problems.push(`${prefix}: duplicate destination`);
      if (to) destinations.add(to);
      if (cleanRelativePath(operation.from) === to)
        problems.push(`${prefix}: source and destination are the same`);
    } else {
      problems.push(`${prefix}: unsupported operation type`);
    }
  }
  return problems;
}

function planSummary(plan: FileOperationPlan, blockedReasons: string[]): string {
  const blocked = blockedReasons.length > 0 ? `\nBlocked: ${blockedReasons.join("; ")}` : "";
  return `${plan.summary}\n${plan.operations.length} proposed operations.${blocked}`;
}

function queuedSummaryForPlan(plan: FileOperationPlan): string {
  const counts = operationCounts(plan);
  const parts = [
    counts.mkdir > 0 ? pluralize(counts.mkdir, "folder", "folders") + " prepared" : "",
    counts.move > 0 ? pluralize(counts.move, "file move", "file moves") + " queued" : "",
    counts.rename > 0 ? pluralize(counts.rename, "rename", "renames") + " queued" : "",
  ].filter(Boolean);
  return parts.length > 0
    ? `${parts.join(", ")}. You can track the operations in Transfers.`
    : "Queued the file plan. You can track the operations in Transfers.";
}

function operationCounts(plan: FileOperationPlan): { mkdir: number; move: number; rename: number } {
  const counts = { mkdir: 0, move: 0, rename: 0 };
  for (const operation of plan.operations) {
    if (operation.type === "mkdir") counts.mkdir += 1;
    if (operation.type === "move") counts.move += 1;
    if (operation.type === "rename") counts.rename += 1;
  }
  return counts;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function serverStatus(running: boolean, error: string | null = null, configured = true): AiStatus {
  return {
    configured,
    spaceScopedSessions: false,
    model: initialAgentModelId,
    modelName: initialAgentModelName,
    running,
    sessionId: activeSessionId,
    error,
  };
}

function statusWithRunning(
  status: AiStatus | null,
  running: boolean,
  error: string | null = null,
): AiStatus {
  return {
    ...(status ?? serverStatus(running)),
    running,
    sessionId: activeSessionId,
    error,
  };
}

function serverStatusFromResponse(response: AgentStatusResponse): AiStatus {
  return {
    configured: response.configured,
    spaceScopedSessions: Boolean(
      response.space_scoped_sessions ?? response.capabilities?.space_scoped_sessions,
    ),
    model: publicAgentModel(response.model),
    modelName: publicAgentDisplayName(response.model, response.model_name),
    running: response.running,
    sessionId: response.session_id ?? activeSessionId,
    error: response.error,
  };
}

function activeSpaceIdFromScopeKey(scopeKey: string): string | undefined {
  const marker = ":space:";
  const index = scopeKey.lastIndexOf(marker);
  if (index < 0) return undefined;
  try {
    return decodeURIComponent(scopeKey.slice(index + marker.length)) || undefined;
  } catch {
    return undefined;
  }
}

function aiMessageId(prefix: string): string {
  const id = `${prefix}-${Date.now()}-${nextMessageId}`;
  nextMessageId += 1;
  return id;
}

function toolArgs(request: ToolRequest): Record<string, unknown> {
  if (!request.arguments || typeof request.arguments !== "object") return {};
  return request.arguments as Record<string, unknown>;
}

function toolOK(request: ToolRequest, result: unknown): ToolResult {
  return { request_id: request.id, name: request.name, ok: true, result };
}

function toolError(request: ToolRequest, error: string): ToolResult {
  return { request_id: request.id, name: request.name, ok: false, error };
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberArg(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relativeToRoot(path: string): string {
  return activeRoot ? (deviceRelativePath(activeRoot, path) ?? "") : "";
}

function absoluteFromRelative(path: string): string {
  const root = activeRoot?.replace(/\/+$/, "");
  if (!root) throw new Error("No active root is available.");
  const cleaned = cleanRelativePath(path);
  if (!cleaned) throw new Error(`Unsafe relative path: ${path}`);
  return `${root}/${cleaned}`;
}

function safeRelativePath(path: string): boolean {
  return Boolean(cleanRelativePath(path));
}

function cleanRelativePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed.startsWith("/") || trimmed.includes(":")) return "";
  if (!trimmed || trimmed === "." || trimmed.includes(":")) return "";
  const parts: string[] = [];
  for (const part of trimmed.split("/")) {
    if (!part || part === "." || part === ".." || part.startsWith(".")) return "";
    parts.push(part);
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function recordAiDebug(level: "info" | "warn" | "error", message: string, detail?: string): void {
  if (!aiDebugEnabled()) return;
  void import("@/platform/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent({ level, scope: "agent", message, detail });
  });
}

function aiDebugEnabled(): boolean {
  return !isNativeMobileBuild && (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
}
