import type {
  AiPanelMessage,
  AssistantScope,
  AssistantRequestScope,
  MikaContextSource,
} from "@/models/types/stores/assistant/useMikaSessionStore";
export type {
  AiPanelMessage,
  AssistantScope,
  AssistantRequestScope,
  MikaContextSource,
} from "@/models/types/stores/assistant/useMikaSessionStore";
import type {
  AiStatus,
  AiPlanReview,
  AiToolApproval,
  SendAiPromptRequest,
  AiConversationSummary,
  AiSessionStore,
} from "@/models/interfaces/stores/assistant/useMikaSessionStore";
export type {
  AiStatus,
  AiPlanReview,
  AiToolApproval,
  SendAiPromptRequest,
  AiConversationSummary,
  AiSessionStore,
} from "@/models/interfaces/stores/assistant/useMikaSessionStore";
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
} from "@/stores/assistant/mikaSessionSync";
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
  mikaServerContext,
} from "@/features/agents/pathPrivacy";
import { mistyDocumentsEnabled } from "@/features/agents/flags";
import { publicMikaDisplayName, publicMikaModel } from "./useMikaDelegationStore";

let pollTimer: number | null = null;
let nextMessageId = 1;
let nextPlanId = 1;
let activeSessionId: string | null = null;
let lastEventSequence = 0;
let activeRoot: string | null = null;
let activeScopeId: string | null = null;
let activeSelectedPaths: string[] = [];
let activeRequestScope: AssistantScope | null = null;
let activeContextSources: MikaContextSource[] = [];
let drainInFlight: Promise<void> | null = null;
let abortRequested = false;
let mikaRuntimeGeneration = 0;
const processedEventSequences = new Set<number>();
const processedToolRequestIds = new Set<string>();
const aiToolTimeoutMs = 15000;

class MikaRuntimeChangedError extends Error {
  constructor() {
    super("Mika conversation changed while the request was running.");
    this.name = "MikaRuntimeChangedError";
  }
}

function mikaRuntimeIsCurrent(generation: number, sessionId?: string | null): boolean {
  return (
    generation === mikaRuntimeGeneration &&
    (sessionId === undefined || sessionId === activeSessionId)
  );
}

function assertMikaRuntime(generation: number, sessionId?: string | null): void {
  if (!mikaRuntimeIsCurrent(generation, sessionId)) throw new MikaRuntimeChangedError();
}

interface ConversationRuntimeSnapshot {
  sessionId: string | null;
  lastEventSequence: number;
  activeRoot: string | null;
  activeScopeId: string | null;
  activeSelectedPaths: string[];
  requestScope: AssistantScope | null;
  contextSources: MikaContextSource[];
}
interface StoredConversation {
  id: string;
  scopeKey: string;
  title: string;
  updatedAt: number;
  status: AiStatus | null;
  mode: AiMode;
  messages: AiPanelMessage[];
  plans: AiPlanReview[];
  toolApprovals: AiToolApproval[];
  error: string | null;
  /** False for a session hydrated from the server whose messages are not loaded yet. */
  transcriptLoaded: boolean;
  runtime: ConversationRuntimeSnapshot;
}

const conversationSnapshots = new Map<string, StoredConversation>();
let nextConversationSeq = 1;
export const filesMikaScopeKey = "files";
let activeConversationScopeKey = filesMikaScopeKey;
let scopeActivationGeneration = 0;
const initialConversationId = newConversationId();

export function spaceMikaScopeKey(accountId: string, spaceId: string): string {
  return `account:${encodeURIComponent(accountId)}:space:${encodeURIComponent(spaceId)}`;
}

function newConversationId(): string {
  return `mika-local-${Date.now()}-${nextConversationSeq++}`;
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
  const title = firstUserMessage
    ? conversationTitleFromText(firstUserMessage)
    : (existing?.title ?? "New chat");
  const updatedAt = Date.now();
  conversationSnapshots.set(id, {
    id,
    scopeKey: activeConversationScopeKey,
    title,
    updatedAt,
    status: state.status,
    mode: state.mode,
    messages: state.messages,
    plans: state.plans,
    toolApprovals: state.toolApprovals,
    error: state.error,
    transcriptLoaded: existing?.transcriptLoaded ?? true,
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
  if (activeSessionId && title !== existing?.title && title !== "New chat") {
    void renameAgentSession(activeSessionId, title).catch(() => undefined);
  }
  set({
    conversations: state.conversations.map((conversation) =>
      conversation.id === id ? { id, title, updatedAt } : conversation,
    ),
  });
}

function mikaSyncDeps() {
  return {
    snapshots: conversationSnapshots,
    createSnapshot: emptyStoredConversation,
    messageId: aiMessageId,
    debug: recordAiDebug,
  };
}

function applyConversationRuntime(snapshot: StoredConversation): void {
  mikaRuntimeGeneration += 1;
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

export const useMikaSessionStore = create<AiSessionStore>((set, get) => ({
  status: serverStatus(false),
  mode: "auto",
  messages: [],
  plans: [],
  toolApprovals: [],
  error: null,
  conversations: [{ id: initialConversationId, title: "New chat", updatedAt: Date.now() }],
  activeConversationId: initialConversationId,
  conversationScopeKey: filesMikaScopeKey,

  refreshStatus: async () => {
    const generation = mikaRuntimeGeneration;
    try {
      const status = await fetchAgentStatus();
      if (!mikaRuntimeIsCurrent(generation)) return;
      set({ status: serverStatusFromResponse(status), error: status.error });
    } catch (error) {
      if (!mikaRuntimeIsCurrent(generation)) return;
      const message = errorText(error);
      recordAiDebug("error", "Mika status check failed.", message);
      set({ status: serverStatus(false, message, false), error: message });
    }
  },

  setMode: (mode) => {
    set({ mode: mode === "full" ? "auto" : mode });
  },

  sendPrompt: async ({ displayPrompt, prompt, cwd, selectedPaths, contextSources }) => {
    const trimmed = displayPrompt.trim();
    if (!trimmed || get().status?.running) return;
    const generation = mikaRuntimeGeneration;
    const conversationId = get().activeConversationId;
    const settingsStore = useSettingsStore.getState();
    if (!settingsStore.loaded) await settingsStore.load();
    if (!mikaRuntimeIsCurrent(generation) || conversationId !== get().activeConversationId) return;
    const preferences = selectAssistantPreferences(useSettingsStore.getState().settings?.document);
    if (!preferences.enabled) {
      appendBlockedRequest(
        set,
        trimmed,
        "Mika is disabled. Enable Mika in Settings > Assistant to continue.",
      );
      return;
    }
    const inSpace = activeConversationScopeKey !== filesMikaScopeKey;
    if (inSpace && !get().status?.spaceScopedSessions) {
      appendBlockedRequest(
        set,
        trimmed,
        "Private Space Mika is unavailable because this Misty server does not support permission-checked Space sessions yet.",
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
    set((state) => ({
      messages: [...state.messages, { id: aiMessageId("user"), role: "user", text: trimmed }],
      error: null,
      status: statusWithRunning(state.status, true),
    }));
    try {
      await ensureSession(generation);
      assertMikaRuntime(generation);
      const registeredScope = cwd
        ? await agentsRegisterFolderScope({ path: cwd }).catch(() => null)
        : null;
      assertMikaRuntime(generation);
      activeScopeId = registeredScope?.id ?? null;
      const serverContext = mikaServerContext(
        cwd,
        selectedPaths ?? [],
        registeredScope?.id ?? null,
      );
      await sendAgentMessageOnce(
        {
          mode: get().mode,
          user_message: scopedAssistantPrompt(prompt, requestScope),
          active_root: serverContext.activeRoot,
          selected_paths: serverContext.selectedPaths,
          capabilities: toolManifestForScope(requestScope),
          space_id: inSpace ? activeSpaceIdFromScopeKey(activeConversationScopeKey) : undefined,
        },
        generation,
      );
      assertMikaRuntime(generation);
      ensureAiPolling(set, get);
      await drainAiEvents(set, get);
    } catch (error) {
      if (error instanceof MikaRuntimeChangedError || !mikaRuntimeIsCurrent(generation)) return;
      stopAiPolling();
      const message = errorText(error);
      if (abortRequested && message.toLowerCase().includes("canceled")) {
        resetActiveSession();
        set((state) => ({ error: null, status: statusWithRunning(state.status, false) }));
        return;
      }
      recordAiDebug("error", "Mika send failed.", message);
      set((state) => ({
        error: message,
        status: statusWithRunning(state.status, false, message),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  approveToolRequest: async (requestId) => {
    const sessionId = activeSessionId;
    const generation = mikaRuntimeGeneration;
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
      assertMikaRuntime(generation, sessionId);
      await submitToolResults(sessionId, [result]);
      assertMikaRuntime(generation, sessionId);
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
      if (error instanceof MikaRuntimeChangedError || !mikaRuntimeIsCurrent(generation, sessionId))
        return;
      const message = errorText(error);
      recordAiDebug("error", "Mika approved tool failed.", message);
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
    const generation = mikaRuntimeGeneration;
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
      assertMikaRuntime(generation);
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
      if (error instanceof MikaRuntimeChangedError || !mikaRuntimeIsCurrent(generation)) return;
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
    const generation = mikaRuntimeGeneration;
    const sessionId = activeSessionId;
    abortRequested = true;
    try {
      if (sessionId) await cancelAgentSession(sessionId);
    } catch (error) {
      if (mikaRuntimeIsCurrent(generation, sessionId)) set({ error: errorText(error) });
    } finally {
      if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
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
        recordAiDebug("warn", "Mika conversation deletion failed.", errorText(error));
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
    const nextScopeKey = scopeKey.trim() || filesMikaScopeKey;
    const generation = ++scopeActivationGeneration;
    if (nextScopeKey === activeConversationScopeKey) return;
    await suspendActiveConversation(set, get);
    if (generation !== scopeActivationGeneration) return;
    activeConversationScopeKey = nextScopeKey;
    const candidates = [...conversationSnapshots.values()]
      .filter((conversation) => conversation.scopeKey === nextScopeKey)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const target = candidates[0] ?? emptyStoredConversation(newConversationId(), Date.now());
    if (!conversationSnapshots.has(target.id)) conversationSnapshots.set(target.id, target);
    applyConversationRuntime(target);
    set({
      activeConversationId: target.id,
      conversationScopeKey: nextScopeKey,
      status: target.status,
      mode: target.mode,
      messages: target.messages,
      plans: target.plans,
      toolApprovals: target.toolApprovals,
      error: target.error,
      conversations: candidates.length
        ? candidates.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
        : [{ id: target.id, title: target.title, updatedAt: target.updatedAt }],
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
      status: fresh.status,
      mode: fresh.mode,
      messages: fresh.messages,
      plans: fresh.plans,
      toolApprovals: fresh.toolApprovals,
      error: fresh.error,
      conversations: [{ id, title: fresh.title, updatedAt: now }, ...state.conversations],
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
        mikaSyncDeps(),
        (messages) => set({ messages }),
        () => get().activeConversationId,
      );
    }
  },

  hydrateConversations: async () => {
    // The current server session schema has no Space scope metadata. Hydrating
    // an unlabelled server session into a Space could expose another Space's
    // private conversation, so only the Files scope may import legacy rows.
    if (activeConversationScopeKey !== filesMikaScopeKey) return;
    const generation = mikaRuntimeGeneration;
    const added = await hydrateServerSessions(mikaSyncDeps());
    if (!mikaRuntimeIsCurrent(generation) || activeConversationScopeKey !== filesMikaScopeKey)
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

export const useAiSessionStore = useMikaSessionStore;

export function resetMikaAccountState(): void {
  stopAiPolling();
  resetActiveSession();
  activeRoot = null;
  conversationSnapshots.clear();
  scopeActivationGeneration += 1;
  activeConversationScopeKey = filesMikaScopeKey;
  activeContextSources = [];
  const freshId = newConversationId();
  useMikaSessionStore.setState({
    status: serverStatus(false),
    mode: "auto",
    messages: [],
    plans: [],
    toolApprovals: [],
    error: null,
    conversations: [{ id: freshId, title: "New chat", updatedAt: Date.now() }],
    activeConversationId: freshId,
    conversationScopeKey: filesMikaScopeKey,
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
    const generation = mikaRuntimeGeneration;
    void drainAiEvents(set, get).catch((error) => {
      if (error instanceof MikaRuntimeChangedError || !mikaRuntimeIsCurrent(generation)) return;
      const message = errorText(error);
      recordAiDebug("error", "Mika polling failed.", message);
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
  const generation = mikaRuntimeGeneration;
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
  if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
  const afterSequence = lastEventSequence;
  const { events } = await fetchAgentEvents(sessionId, afterSequence);
  if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
  const nextEvents = events.filter((event) => {
    if (event.sequence <= lastEventSequence) return false;
    if (processedEventSequences.has(event.sequence)) return false;
    processedEventSequences.add(event.sequence);
    return true;
  });
  recordAiDebug(
    "info",
    "Fetched Mika events.",
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
        creditsUsed: event.credits_used,
        creditsRemaining: event.credits_remaining,
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
          recordAiDebug("info", "Running Mika tool request.", `${request.name} ${request.id}`);
          toolResults.push(await runToolRequestWithTimeout(request, activeRequestScope));
          if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
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
  if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
  set((state) => ({
    messages: [...state.messages, ...nextMessages],
    plans: [...state.plans, ...nextPlans],
    toolApprovals: [...state.toolApprovals, ...nextToolApprovals],
    status: statusWithRunning(state.status, toolResults.length > 0),
  }));
  if (toolResults.length > 0) {
    await submitToolResults(sessionId, toolResults);
    if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
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
  if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
  try {
    const status = await fetchAgentStatus();
    if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
    if (status.running) {
      set({ status: serverStatusFromResponse(status) });
      ensureAiPolling(set, useMikaSessionStore.getState);
      return;
    }
    set({ status: serverStatusFromResponse(status) });
  } catch {
    if (!mikaRuntimeIsCurrent(generation, sessionId)) return;
    set({ status: serverStatus(false) });
  }
  stopAiPolling();
}

function stopAiPolling(): void {
  if (pollTimer === null || typeof window === "undefined") return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

async function ensureSession(generation = mikaRuntimeGeneration): Promise<string> {
  assertMikaRuntime(generation);
  if (activeSessionId) return activeSessionId;
  const scopeKey = activeConversationScopeKey;
  const session = await createAgentSession(
    undefined,
    scopeKey === filesMikaScopeKey ? undefined : activeSpaceIdFromScopeKey(scopeKey),
  );
  assertMikaRuntime(generation);
  if (scopeKey !== activeConversationScopeKey) throw new MikaRuntimeChangedError();
  activeSessionId = session.session_id;
  lastEventSequence = 0;
  recordAiDebug("info", "Created Mika session.", activeSessionId);
  return activeSessionId;
}

async function sendAgentMessageOnce(
  body: Parameters<typeof sendAgentMessage>[1],
  generation = mikaRuntimeGeneration,
): Promise<void> {
  const sessionId = await ensureSession(generation);
  assertMikaRuntime(generation, sessionId);
  recordAiDebug(
    "info",
    "Sending message to Mika server.",
    `session=${sessionId} cwd=${activeRoot ?? ""}`,
  );
  try {
    await sendAgentMessage(sessionId, body);
    assertMikaRuntime(generation, sessionId);
  } catch (error) {
    assertMikaRuntime(generation, sessionId);
    if (isSessionNotFoundError(error)) {
      resetActiveSession(false);
      throw new Error(
        "Mika session expired. Your request was not resent. Send it again to continue.",
      );
    }
    throw error;
  }
}

function resetActiveSession(invalidateRuntime = true): void {
  if (invalidateRuntime) mikaRuntimeGeneration += 1;
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
    model: "mika-low",
    modelName: "Mika Low",
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
    model: publicMikaModel(response.model),
    modelName: publicMikaDisplayName(response.model, response.model_name),
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
    recordClientDebugEvent({ level, scope: "mika", message, detail });
  });
}

function aiDebugEnabled(): boolean {
  return !isNativeMobileBuild && (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
}
