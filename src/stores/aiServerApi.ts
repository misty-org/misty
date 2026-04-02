import { appSnapshot } from "../api/misty";
import { readAccountAuthToken } from "../pages/Account/shared/authTokenStore";

export type AiMode = "ask" | "auto" | "full";

export interface ToolDefinition {
  name: string;
  risk: "read" | "write" | "dangerous";
}

export interface ToolManifest {
  tools: ToolDefinition[];
}

export interface AgentMessageRequest {
  mode: AiMode;
  user_message: string;
  active_root?: string;
  selected_paths?: string[];
  capabilities: ToolManifest;
}

export interface ToolRequest {
  id: string;
  name: string;
  risk: "read" | "write" | "dangerous";
  approval_required: boolean;
  arguments?: unknown;
}

export interface ToolResult {
  request_id: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface FileOperationPlan {
  summary: string;
  completion_summary?: string;
  operations: FileOperation[];
  warnings: string[];
}

export type FileOperation =
  | { type: "mkdir"; path: string; reason?: string }
  | { type: "move"; from: string; to: string; reason?: string; confidence?: number }
  | { type: "rename"; from: string; to: string; reason?: string; confidence?: number };

export interface AgentEvent {
  sequence: number;
  type: "assistant_message" | "tool_request" | "file_plan" | "error";
  text?: string;
  tool_requests?: ToolRequest[];
  file_plan?: FileOperationPlan;
  message?: string;
  created_at: string;
  credits_used?: number;
  credits_remaining?: number;
}

export interface AgentEventsResponse {
  events: AgentEvent[];
}

export interface CreateSessionResponse {
  session_id: string;
}

export interface AgentStatusResponse {
  configured: boolean;
  provider: string;
  model: string;
  model_name?: string;
  running: boolean;
  session_id: string | null;
  error: string | null;
}

export async function fetchAgentStatus(): Promise<AgentStatusResponse> {
  return managedAiRequest<AgentStatusResponse>("/ai/status");
}

export async function createAgentSession(): Promise<CreateSessionResponse> {
  return managedAiRequest<CreateSessionResponse>("/ai/sessions", { method: "POST" });
}

export async function sendAgentMessage(sessionId: string, body: AgentMessageRequest): Promise<void> {
  await managedAiRequest(`/ai/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchAgentEvents(sessionId: string, after: number): Promise<AgentEventsResponse> {
  return managedAiRequest<AgentEventsResponse>(`/ai/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`);
}

export async function submitToolResults(sessionId: string, results: ToolResult[]): Promise<void> {
  await managedAiRequest(`/ai/sessions/${encodeURIComponent(sessionId)}/tool-results`, {
    method: "POST",
    body: JSON.stringify({ results }),
  });
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
  await managedAiRequest(`/ai/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: "POST" });
}

export async function managedAiRequest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const base = await resolveServerApiBase();
  if (!base) throw new Error("Misty server URL is not configured.");
  const token = await readAccountAuthToken();
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    let payload: ManagedAiErrorPayload | null = null;
    try {
      payload = JSON.parse(text) as ManagedAiErrorPayload;
    } catch {
      // Plain-text errors are handled below.
    }
    if (payload) {
      if (payload.code === "credits_exhausted") {
        const reset = payload.reset_at ? new Date(payload.reset_at).toLocaleDateString() : "your next reset";
        throw new Error(`Misty credits exhausted (${payload.available_credits ?? 0} available). Add credits or wait until ${reset}.`);
      }
      if (payload.code === "insufficient_credits") {
        const required = typeof payload.requiredCredits === "number" ? ` ${payload.requiredCredits} Mika credits are required.` : "";
        throw new Error(`${payload.message?.trim() || "Not enough Mika credits for this request."}${required}`);
      }
      if (payload.code === "rate_limited") {
        throw new Error(`Mika request limit reached. Try again in ${payload.retry_after_seconds ?? 1} seconds. Requests are never retried automatically.`);
      }
      if (payload.code === "request_canceled") {
        throw new Error("Mika request canceled.");
      }
      if (payload.message?.trim()) throw new Error(payload.message.trim());
    }
    throw new Error(text.trim() || `Mika ${path} failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.includes("application/json") ? await response.json() as T : undefined as T;
}

interface ManagedAiErrorPayload {
  code?: string;
  message?: string;
  available_credits?: number;
  availableCredits?: number;
  requiredCredits?: number;
  reset_at?: string;
  retry_after_seconds?: number;
}

async function resolveServerApiBase(): Promise<string> {
  const explicitServerUrl = normalizeBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL);
  const envApiBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE);
  const nativeServerUrl = normalizeBaseUrl((await loadAppSnapshot())?.environment.serverUrl);
  const localBetaServerUrl = import.meta.env.DEV ? "http://localhost:8080" : null;
  return withApiPath(explicitServerUrl ?? envApiBase ?? nativeServerUrl ?? localBetaServerUrl);
}

async function loadAppSnapshot() {
  try {
    return await appSnapshot();
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
}

function withApiPath(base: string | null): string {
  if (!base) return "";
  return /\/api$/i.test(base) ? base : `${base}/api`;
}
