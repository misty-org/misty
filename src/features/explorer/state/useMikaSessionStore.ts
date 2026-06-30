import { create } from "zustand";
import {
  explorerCreateItem,
  explorerListDirectory,
  explorerQueuePasteItems,
  explorerQueueRenameItem,
  searchQuery,
} from "../../../api/misty";
import { recordClientDebugEvent } from "../../../shared/debug/clientDebug";
import { errorText } from "../../../shared/format";
import {
  cancelAgentSession,
  createAgentSession,
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

export type AiPanelMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "error" | "plan";
  text: string;
  planId?: string;
  toolRequestId?: string;
};

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
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
}

export interface AiToolApproval {
  id: string;
  request: ToolRequest;
  running: boolean;
  completed: boolean;
  error: string | null;
}

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
let drainInFlight: Promise<void> | null = null;
const processedEventSequences = new Set<number>();
const processedToolRequestIds = new Set<string>();
const aiToolTimeoutMs = 15000;

const toolManifest: ToolManifest = {
  tools: [
    { name: "list_directory", risk: "read" },
    { name: "search_files", risk: "read" },
    { name: "validate_file_plan", risk: "read" },
    { name: "apply_file_plan", risk: "write" },
  ],
};

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
    activeRoot = cwd || null;
    set((state) => ({
      messages: [...state.messages, { id: aiMessageId("user"), role: "user", text: trimmed }],
      error: null,
      status: serverStatus(true),
    }));

    try {
      await sendAgentMessageWithSessionRetry({
        mode: get().mode,
        user_message: prompt,
        active_root: cwd || undefined,
        selected_paths: selectedPaths,
        capabilities: toolManifest,
      });
      ensureAiPolling(set, get);
      await drainAiEvents(set, get);
    } catch (error) {
      stopAiPolling();
      const message = errorText(error);
      recordAiDebug("error", "Mika send failed.", message);
      set((state) => ({
        error: message,
        status: serverStatus(false, message),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  approveToolRequest: async (requestId) => {
    const sessionId = activeSessionId;
    const approval = get().toolApprovals.find((candidate) => candidate.id === requestId);
    if (!sessionId || !approval || approval.running || approval.completed) return;
    set((state) => ({
      status: serverStatus(true),
      toolApprovals: state.toolApprovals.map((candidate) => candidate.id === requestId ? { ...candidate, running: true, error: null } : candidate),
    }));
    try {
      const result = await runToolRequest(approval.request);
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
        status: serverStatus(false, message),
        toolApprovals: state.toolApprovals.map((candidate) => candidate.id === requestId ? { ...candidate, running: false, error: message } : candidate),
        messages: [...state.messages, { id: aiMessageId("error"), role: "error", text: message }],
      }));
    }
  },

  approvePlan: async (planId) => {
    const plan = get().plans.find((candidate) => candidate.id === planId);
    if (!plan || plan.applied || plan.applying) return;
    const blockedReasons = validateClientPlan(plan.plan);
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
    try {
      if (activeSessionId) await cancelAgentSession(activeSessionId);
      stopAiPolling();
      drainInFlight = null;
      set({ status: serverStatus(false) });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  clearConversation: () => {
    stopAiPolling();
    activeSessionId = null;
    lastEventSequence = 0;
    drainInFlight = null;
    processedEventSequences.clear();
    processedToolRequestIds.clear();
    set({ messages: [], plans: [], toolApprovals: [], error: null, status: serverStatus(false) });
  },
}));

export const useAiSessionStore = useMikaSessionStore;

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
        status: serverStatus(false, message),
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
      nextMessages.push({ id: aiMessageId("assistant"), role: "assistant", text: event.text });
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
          toolResults.push(await runToolRequestWithTimeout(request));
        } else {
          nextToolApprovals.push({ id: request.id, request, running: false, completed: false, error: null });
        }
      }
    } else if (event.type === "file_plan" && event.file_plan) {
      const planId = `plan-${Date.now()}-${nextPlanId++}`;
      const blockedReasons = validateClientPlan(event.file_plan);
      nextPlans.push({ id: planId, plan: event.file_plan, applied: false, applying: false, appliedSummary: null, blockedReasons });
      nextMessages.push({ id: aiMessageId("plan"), role: "plan", planId, text: planSummary(event.file_plan, blockedReasons) });
    }
  }
  set((state) => ({
    messages: [...state.messages, ...nextMessages],
    plans: [...state.plans, ...nextPlans],
    toolApprovals: [...state.toolApprovals, ...nextToolApprovals],
    status: serverStatus(toolResults.length > 0),
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

async function sendAgentMessageWithSessionRetry(body: Parameters<typeof sendAgentMessage>[1]): Promise<void> {
  let sessionId = await ensureSession();
  try {
    recordAiDebug("info", "Sending message to Mika server.", `session=${sessionId} cwd=${activeRoot ?? ""}`);
    await sendAgentMessage(sessionId, body);
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    recordAiDebug("warn", "Mika session expired; creating a new session.", sessionId);
    resetActiveSession();
    sessionId = await ensureSession();
    await sendAgentMessage(sessionId, body);
  }
}

function resetActiveSession(): void {
  activeSessionId = null;
  lastEventSequence = 0;
  drainInFlight = null;
  processedEventSequences.clear();
  processedToolRequestIds.clear();
}

function isSessionNotFoundError(error: unknown): boolean {
  return errorText(error).toLowerCase().includes("session not found");
}

async function runToolRequest(request: ToolRequest): Promise<ToolResult> {
  try {
    const args = toolArgs(request);
    switch (request.name) {
      case "list_directory": {
        const listing = await explorerListDirectory({ path: stringArg(args.path) || activeRoot });
        return toolOK(request, {
          path: listing.path,
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
        return toolOK(request, { results });
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

async function runToolRequestWithTimeout(request: ToolRequest): Promise<ToolResult> {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      runToolRequest(request),
      new Promise<ToolResult>((resolve) => {
        timeoutId = window.setTimeout(() => {
          resolve(toolError(request, `${request.name} timed out after ${Math.round(aiToolTimeoutMs / 1000)} seconds.`));
        }, aiToolTimeoutMs);
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
    provider: "Misty Server",
    model: "mock",
    running,
    sessionId: activeSessionId,
    error,
  };
}

function serverStatusFromResponse(response: AgentStatusResponse): AiStatus {
  return {
    configured: response.configured,
    provider: response.provider || "Misty Server",
    model: response.model || "mock",
    running: response.running,
    sessionId: response.session_id ?? activeSessionId,
    error: response.error,
  };
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
  const root = activeRoot?.replace(/\/+$/, "");
  if (!root) return path;
  if (path === root) return "";
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return path;
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
  recordClientDebugEvent({ level, scope: "mika", message, detail });
}
