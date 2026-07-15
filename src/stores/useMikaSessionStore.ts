import { create } from "zustand";
import {
  explorerCreateItem,
  explorerListDirectory,
  explorerQueuePasteItems,
  explorerQueueRenameItem,
  searchQuery,
} from "../api/misty";
import { errorText } from "../shared/format";
import { isNativeMobileBuild } from "../platform/buildTarget";
import { selectAssistantPreferences, useSettingsStore } from "./useSettingsStore";
import {
  cancelAgentSession,
  createAgentSession,
  deleteAgentSession,
  fetchAgentStatus,
  fetchAgentEvents,
  sendAgentMessage,
  submitToolResults,
  type AiMode,
  type AgentStatusResponse,
  type FileOperationPlan,
  type ToolManifest,
  type ToolRequest,
  type ToolResult,
} from "./aiServerApi";
import { agentsPrepareDocument, agentsRegisterFolderScope } from "../agents/api";
import type { AgentCitation } from "../agents/types";
import { deviceRelativePath, isSafeRelativePath, mikaServerContext } from "../agents/pathPrivacy";
import { mistyDocumentsEnabled } from "../agents/flags";

export type AiPanelMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "error" | "plan";
  text: string;
  planId?: string;
  toolRequestId?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  citations?: AgentCitation[];
};

export interface AiStatus {
  configured: boolean;
  model: string;
  modelName: string;
  running: boolean;
  sessionId: string | null;
  error: string | null;
}

export interface AiPlanReview {
  id: string;
  plan: FileOperationPlan;
  applied: boolean;
  applying: boolean;
  appliedSummary: string | null;
  blockedReasons: string[];
  scope: AssistantScope | null;
}

export interface AiToolApproval {
  id: string;
  request: ToolRequest;
  running: boolean;
  completed: boolean;
  error: string | null;
  scope: AssistantScope | null;
}

export type AssistantScope = "files" | "cleanup" | "search";
type AssistantRequestScope = AssistantScope | "ambiguous" | null;

interface SendAiPromptRequest {
  displayPrompt: string;
  prompt: string;
  cwd: string | null;
  selectedPaths?: string[];
}

interface AiSessionStore {
  status: AiStatus | null;
  mode: AiMode;
  messages: AiPanelMessage[];
  plans: AiPlanReview[];
  toolApprovals: AiToolApproval[];
  error: string | null;
  refreshStatus: () => Promise<void>;
  setMode: (mode: AiMode) => void;
  sendPrompt: (request: SendAiPromptRequest) => Promise<void>;
  approveToolRequest: (requestId: string) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  abortPrompt: () => Promise<void>;
  clearConversation: () => void;
}

let pollTimer: number | null = null;
let nextMessageId = 1;
let nextPlanId = 1;
let activeSessionId: string | null = null;
let lastEventSequence = 0;
let activeRoot: string | null = null;
let activeScopeId: string | null = null;
let activeSelectedPaths: string[] = [];
let activeRequestScope: AssistantScope | null = null;
let drainInFlight: Promise<void> | null = null;
let abortRequested = false;
const processedEventSequences = new Set<number>();
const processedToolRequestIds = new Set<string>();
const aiToolTimeoutMs = 15000;

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
    return { tools: [toolDefinitions.list_directory, toolDefinitions.validate_file_plan, toolDefinitions.apply_file_plan] };
  }
  if (scope === "cleanup") {
    return { tools: [toolDefinitions.list_directory, toolDefinitions.search_files, ...previewTools, toolDefinitions.validate_file_plan] };
  }
  if (scope === "search") {
    return { tools: [toolDefinitions.list_directory, toolDefinitions.search_files, ...previewTools] };
  }
  return { tools: [] };
}

function toolAllowedForScope(toolName: string, scope: AssistantScope): boolean {
  return toolManifestForScope(scope).tools.some((tool) => tool.name === toolName);
}

function classifyAssistantRequest(prompt: string): AssistantRequestScope {
  const normalized = prompt.toLowerCase();
  const matches: AssistantScope[] = [];
  if (/\b(clean(?:up)?|tidy|declutter|organize|duplicate|unused|large files?|old files?)\b/.test(normalized)) matches.push("cleanup");
  if (/\b(search|find|locate|look for|where (?:is|are)|collections?|smart folder|query|tagged|tags?)\b/.test(normalized)) matches.push("search");
  if (/\b(summar(?:y|ize)|compare|analy[sz]e|explain|extract|question|read|review|pdf|document|spreadsheet|presentation|slide|contract|report)\b/.test(normalized)) matches.push("search");
  if (/\b(open|reveal|show in finder|copy|move|rename|create|make (?:a )?(?:file|folder)|transfer|download|upload)\b/.test(normalized)) matches.push("files");
  const distinct = [...new Set(matches)];
  if (distinct.length > 1) return "ambiguous";
  return distinct[0] ?? null;
}

function isDocumentAssistantRequest(prompt: string): boolean {
  return /\b(summar(?:y|ize)|compare|analy[sz]e|explain|extract|question|read|review|pdf|document|spreadsheet|presentation|slide|contract|report)\b/i.test(prompt);
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
  set: (partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>)) => void,
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

  refreshStatus: async () => {
    try {
      const status = await fetchAgentStatus();
      set({ status: serverStatusFromResponse(status), error: status.error });
    } catch (error) {
      const message = errorText(error);
      recordAiDebug("error", "Mika status check failed.", message);
      set({ status: serverStatus(false, message, false), error: message });
    }
  },

  setMode: (mode) => {
    set({ mode: mode === "full" ? "auto" : mode });
  },

  sendPrompt: async ({ displayPrompt, prompt, cwd, selectedPaths }) => {
    const trimmed = displayPrompt.trim();
    if (!trimmed || get().status?.running) return;
    const settingsStore = useSettingsStore.getState();
    if (!settingsStore.loaded) await settingsStore.load();
    const preferences = selectAssistantPreferences(useSettingsStore.getState().settings?.document);
    if (!preferences.enabled) {
      appendBlockedRequest(set, trimmed, "Mika is disabled. Enable Mika in Settings > Assistant to continue.");
      return;
    }
    if (isDocumentAssistantRequest(trimmed) && !mistyDocumentsEnabled()) {
      appendBlockedRequest(set, trimmed, "Misty document intelligence is not enabled for this rollout.");
      return;
    }
    const requestScope = classifyAssistantRequest(trimmed);
    if (requestScope === "ambiguous") {
      appendBlockedRequest(set, trimmed, "That request crosses more than one permission scope. Please split it into separate Files, Cleanup, or Search steps.");
      return;
    }
    if (requestScope && !assistantScopeAllowed(preferences, requestScope)) {
      appendBlockedRequest(set, trimmed, `The ${assistantScopeLabel(requestScope)} scope is disabled. Allow it in Settings > Assistant to continue.`);
      return;
    }
    activeRoot = cwd || null;
    activeSelectedPaths = selectedPaths ?? [];
    activeRequestScope = requestScope;
    abortRequested = false;
    set((state) => ({
      messages: [...state.messages, { id: aiMessageId("user"), role: "user", text: trimmed }],
      error: null,
      status: statusWithRunning(state.status, true),
    }));

    try {
      const registeredScope = cwd
        ? await agentsRegisterFolderScope({ path: cwd }).catch(() => null)
        : null;
      activeScopeId = registeredScope?.id ?? null;
      const serverContext = mikaServerContext(cwd, selectedPaths ?? [], registeredScope?.id ?? null);
      await sendAgentMessageOnce({
        mode: get().mode,
        user_message: scopedAssistantPrompt(prompt, requestScope),
        active_root: serverContext.activeRoot,
        selected_paths: serverContext.selectedPaths,
        capabilities: toolManifestForScope(requestScope),
      });
      ensureAiPolling(set, get);
      await drainAiEvents(set, get);
    } catch (error) {
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
    const approval = get().toolApprovals.find((candidate) => candidate.id === requestId);
    if (!sessionId || !approval || approval.running || approval.completed) return;
    set((state) => ({
      status: statusWithRunning(state.status, true),
      toolApprovals: state.toolApprovals.map((candidate) => candidate.id === requestId ? { ...candidate, running: true, error: null } : candidate),
    }));
    try {
      const result = await runToolRequest(approval.request, approval.scope);
      await submitToolResults(sessionId, [result]);
      set((state) => ({
        toolApprovals: state.toolApprovals.map((candidate) => candidate.id === requestId ? {
          ...candidate,
          running: false,
          completed: true,
          error: result.ok ? null : result.error ?? "Tool failed",
        } : candidate),
      }));
      ensureAiPolling(set, get);
      await drainAiEvents(set, get);
    } catch (error) {
      const message = errorText(error);
      recordAiDebug("error", "Mika approved tool failed.", message);
      set((state) => ({
        error: message,
        status: statusWithRunning(state.status, false, message),
        toolApprovals: state.toolApprovals.map((candidate) => candidate.id === requestId ? { ...candidate, running: false, error: message } : candidate),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  approvePlan: async (planId) => {
    const plan = get().plans.find((candidate) => candidate.id === planId);
    if (!plan || plan.applied || plan.applying) return;
    const blockedReasons = plan.scope !== "files"
      ? [plan.scope === "cleanup" ? "Cleanup plans are review-only in V1." : "The Files scope is required to apply this plan."]
      : validateClientPlan(plan.plan);
    if (blockedReasons.length > 0) {
      set((state) => ({
        plans: state.plans.map((candidate) => candidate.id === planId ? { ...candidate, blockedReasons } : candidate),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: `Plan blocked: ${blockedReasons.join("; ")}` }],
      }));
      return;
    }
    set((state) => ({
      plans: state.plans.map((candidate) => candidate.id === planId ? { ...candidate, applying: true, blockedReasons: [] } : candidate),
    }));
    try {
      await applyFilePlan(plan.plan);
      const appliedSummary = queuedSummaryForPlan(plan.plan);
      set((state) => ({
        plans: state.plans.map((candidate) => candidate.id === planId ? { ...candidate, applied: true, applying: false, appliedSummary } : candidate),
        messages: [...state.messages, { id: aiMessageId("assistant"), role: "assistant", text: appliedSummary }],
      }));
    } catch (error) {
      const message = errorText(error);
      set((state) => ({
        error: message,
        plans: state.plans.map((candidate) => candidate.id === planId ? { ...candidate, applying: false, blockedReasons: [message] } : candidate),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  abortPrompt: async () => {
    abortRequested = true;
    try {
      if (activeSessionId) await cancelAgentSession(activeSessionId);
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      stopAiPolling();
      drainInFlight = null;
      resetActiveSession();
      set((state) => ({ status: statusWithRunning(state.status, false) }));
    }
  },

  clearConversation: () => {
    const sessionId = activeSessionId;
    if (sessionId) void deleteAgentSession(sessionId).catch((error) => {
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
    set({ messages: [], plans: [], toolApprovals: [], error: null, status: serverStatus(false) });
  },
}));

export const useAiSessionStore = useMikaSessionStore;

export function resetMikaAccountState(): void {
  stopAiPolling();
  resetActiveSession();
  activeRoot = null;
  useMikaSessionStore.setState({
    status: serverStatus(false),
    mode: "auto",
    messages: [],
    plans: [],
    toolApprovals: [],
    error: null,
  });
}

function ensureAiPolling(
  set: (partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>)) => void,
  get: () => AiSessionStore,
): void {
  if (pollTimer !== null || typeof window === "undefined") return;
  pollTimer = window.setInterval(() => {
    void drainAiEvents(set, get).catch((error) => {
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
  set: (partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>)) => void,
  get: () => AiSessionStore,
): Promise<void> {
  if (drainInFlight) return drainInFlight;
  drainInFlight = drainAiEventsOnce(set, get).finally(() => {
    drainInFlight = null;
  });
  return drainInFlight;
}

async function drainAiEventsOnce(
  set: (partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>)) => void,
  get: () => AiSessionStore,
): Promise<void> {
  const sessionId = activeSessionId;
  if (!sessionId) return;
  const afterSequence = lastEventSequence;
  const { events } = await fetchAgentEvents(sessionId, afterSequence);
  const nextEvents = events.filter((event) => {
    if (event.sequence <= lastEventSequence) return false;
    if (processedEventSequences.has(event.sequence)) return false;
    processedEventSequences.add(event.sequence);
    return true;
  });
  recordAiDebug("info", "Fetched Mika events.", `session=${sessionId} count=${events.length} new=${nextEvents.length} after=${afterSequence}`);
  if (nextEvents.length === 0) {
    await settleEmptyEventPoll(set);
    return;
  }

  const toolResults: ToolResult[] = [];
  const nextMessages: AiPanelMessage[] = [];
  const nextPlans: AiPlanReview[] = [];
  const nextToolApprovals: AiToolApproval[] = [];
  for (const event of nextEvents) {
    lastEventSequence = Math.max(lastEventSequence, event.sequence);
    if (event.type === "assistant_message" && event.text) {
      nextMessages.push({ id: aiMessageId("assistant"), role: "assistant", text: event.text, citations: event.citations, creditsUsed: event.credits_used, creditsRemaining: event.credits_remaining });
    } else if (event.type === "error" && event.message) {
      nextMessages.push({ id: aiMessageId("error"), role: "error", text: event.message });
    } else if (event.type === "tool_request") {
      for (const request of event.tool_requests ?? []) {
        if (processedToolRequestIds.has(request.id)) continue;
        processedToolRequestIds.add(request.id);
        nextMessages.push({
          id: aiMessageId("tool"),
          role: "tool",
          toolRequestId: request.approval_required && get().mode !== "full" ? request.id : undefined,
          text: request.approval_required ? `Approval required: ${request.name}` : `Running ${request.name}`,
        });
        if (!request.approval_required || get().mode === "full") {
          recordAiDebug("info", "Running Mika tool request.", `${request.name} ${request.id}`);
          toolResults.push(await runToolRequestWithTimeout(request, activeRequestScope));
        } else {
          nextToolApprovals.push({ id: request.id, request, running: false, completed: false, error: null, scope: activeRequestScope });
        }
      }
    } else if (event.type === "file_plan" && event.file_plan) {
      const planId = `plan-${Date.now()}-${nextPlanId++}`;
      const blockedReasons = activeRequestScope === "cleanup"
        ? ["Cleanup plans are review-only in V1."]
        : activeRequestScope === "files"
          ? validateClientPlan(event.file_plan)
          : ["The Files scope is required to apply this plan."];
      nextPlans.push({ id: planId, plan: event.file_plan, applied: false, applying: false, appliedSummary: null, blockedReasons, scope: activeRequestScope });
      nextMessages.push({ id: aiMessageId("plan"), role: "plan", planId, text: planSummary(event.file_plan, blockedReasons) });
    }
  }
  set((state) => ({
    messages: [...state.messages, ...nextMessages],
    plans: [...state.plans, ...nextPlans],
    toolApprovals: [...state.toolApprovals, ...nextToolApprovals],
    status: statusWithRunning(state.status, toolResults.length > 0),
  }));
  if (toolResults.length > 0) {
    await submitToolResults(sessionId, toolResults);
    await drainAiEventsOnce(set, get);
    return;
  }
  await settleEmptyEventPoll(set);
}

async function settleEmptyEventPoll(
  set: (partial: Partial<AiSessionStore> | ((state: AiSessionStore) => Partial<AiSessionStore>)) => void,
): Promise<void> {
  try {
    const status = await fetchAgentStatus();
    if (status.running) {
      set({ status: serverStatusFromResponse(status) });
      ensureAiPolling(set, useMikaSessionStore.getState);
      return;
    }
    set({ status: serverStatusFromResponse(status) });
  } catch {
    set({ status: serverStatus(false) });
  }
  stopAiPolling();
}

function stopAiPolling(): void {
  if (pollTimer === null || typeof window === "undefined") return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

async function ensureSession(): Promise<string> {
  if (activeSessionId) return activeSessionId;
  const session = await createAgentSession();
  activeSessionId = session.session_id;
  lastEventSequence = 0;
  recordAiDebug("info", "Created Mika session.", activeSessionId);
  return activeSessionId;
}

async function sendAgentMessageOnce(body: Parameters<typeof sendAgentMessage>[1]): Promise<void> {
  const sessionId = await ensureSession();
  recordAiDebug("info", "Sending message to Mika server.", `session=${sessionId} cwd=${activeRoot ?? ""}`);
  try {
    await sendAgentMessage(sessionId, body);
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      resetActiveSession();
      throw new Error("Mika session expired. Your request was not resent. Send it again to continue.");
    }
    throw error;
  }
}

function resetActiveSession(): void {
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

async function runToolRequest(request: ToolRequest, scope: AssistantScope | null): Promise<ToolResult> {
  try {
    const preferences = selectAssistantPreferences(useSettingsStore.getState().settings?.document);
    if (!scope || !assistantScopeAllowed(preferences, scope)) {
      return toolError(request, scope
        ? `The ${assistantScopeLabel(scope)} scope is disabled.`
        : "This request has no allowed capability scope.");
    }
    if (!toolAllowedForScope(request.name, scope)) {
      return toolError(request, `${request.name} is not allowed by the ${assistantScopeLabel(scope)} scope.`);
    }
    const args = toolArgs(request);
    switch (request.name) {
      case "list_directory": {
        const requestedPath = stringArg(args.path);
        const directoryPath = !requestedPath || requestedPath === "." || requestedPath === activeScopeId
          ? activeRoot
          : isSafeRelativePath(requestedPath)
            ? absoluteFromRelative(requestedPath)
            : null;
        if (!directoryPath) return toolError(request, "list_directory requires a path relative to the active agent scope.");
        const listing = await explorerListDirectory({ path: directoryPath });
        return toolOK(request, {
          path: activeRoot ? deviceRelativePath(activeRoot, listing.path) ?? "." : ".",
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
            return [{
              name: result.entry.name,
              path,
              kind: result.entry.kind,
              extension: result.entry.extension,
              sizeBytes: result.entry.sizeBytes,
              modifiedMs: result.entry.modifiedMs,
              score: result.score,
              match: result.match,
            }];
          }),
        });
      }
      case "preview_file": {
        const requested = stringArg(args.path);
        if (requested && !isSafeRelativePath(requested)) {
          return toolError(request, "preview_file requires a path relative to the active agent scope.");
        }
        const candidate = requested ? absoluteFromRelative(requested) : activeSelectedPaths[0];
        if (!candidate) return toolError(request, "Select a document or provide a path to preview_file.");
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
          requiresOcr: document.requiresOcr,
          citationRule: "Cite every factual document claim using the supplied scopeId, relativePath, fileName, section kind, and locator.",
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

async function runToolRequestWithTimeout(request: ToolRequest, scope: AssistantScope | null): Promise<ToolResult> {
  let timeoutId: number | null = null;
  try {
    const timeoutMs = request.name === "preview_file" ? 60_000 : aiToolTimeoutMs;
    return await Promise.race([
      runToolRequest(request, scope),
      new Promise<ToolResult>((resolve) => {
        timeoutId = window.setTimeout(() => {
          resolve(toolError(request, `${request.name} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
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
  const orderedFolders = [...folderPaths].sort((left, right) => left.split("/").length - right.split("/").length);
  for (const relativeFolder of orderedFolders) {
    const target = absoluteFromRelative(relativeFolder);
    try {
      await explorerCreateItem({ directory: dirname(target), name: basename(target), kind: "folder" });
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
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) problems.push("at least one operation is required");
  for (const [index, operation] of plan.operations.entries()) {
    const prefix = `operations[${index}]`;
    if (operation.type === "mkdir") {
      if (!safeRelativePath(operation.path)) problems.push(`${prefix}: mkdir path must be relative and safe`);
      else destinations.add(cleanRelativePath(operation.path));
    } else if (operation.type === "move" || operation.type === "rename") {
      if (!safeRelativePath(operation.from)) problems.push(`${prefix}: source must be relative and safe`);
      if (!safeRelativePath(operation.to)) problems.push(`${prefix}: destination must be relative and safe`);
      const to = cleanRelativePath(operation.to);
      if (to && destinations.has(to)) problems.push(`${prefix}: duplicate destination`);
      if (to) destinations.add(to);
      if (cleanRelativePath(operation.from) === to) problems.push(`${prefix}: source and destination are the same`);
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
    model: "mika-low",
    modelName: "Mika Low",
    running,
    sessionId: activeSessionId,
    error,
  };
}

function statusWithRunning(status: AiStatus | null, running: boolean, error: string | null = null): AiStatus {
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
    model: publicMikaModel(response.model),
    modelName: publicMikaDisplayName(response.model, response.model_name),
    running: response.running,
    sessionId: response.session_id ?? activeSessionId,
    error: response.error,
  };
}

function publicMikaModel(model: string): string {
  return model === "mika-med" || model === "mika-high" ? model : "mika-low";
}

function mikaModelDisplayName(model: string): string {
  if (model === "mika-med") return "Mika Med";
  if (model === "mika-high") return "Mika High";
  return "Mika Low";
}

function publicMikaDisplayName(model: string, modelName?: string): string {
  const expected = mikaModelDisplayName(model);
  return modelName === expected ? modelName : expected;
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
  return activeRoot ? deviceRelativePath(activeRoot, path) ?? "" : "";
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
  void import("../shared/debug/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent({ level, scope: "mika", message, detail });
  });
}

function aiDebugEnabled(): boolean {
  return !isNativeMobileBuild &&
    (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
}
