import { readAccountAuthToken } from "../pages/Account/shared/authTokenStore";
import { appSnapshot } from "../api/misty";
import type {
  MessageSpan,
  Space,
  SpaceEvent,
  SpaceInboxItem,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpacesSnapshot,
  SpaceStudioResource,
  SpaceRun,
} from "./types";

export class SpaceRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "SpaceRequestError";
  }
}

export async function resolveSpacesApiBase(): Promise<string> {
  const explicit = normalizeBase(import.meta.env.VITE_MISTY_SERVER_URL);
  const envBase = normalizeBase(import.meta.env.VITE_API_BASE);
  let native: string | null = null;
  try { native = normalizeBase((await appSnapshot()).environment.serverUrl); } catch { /* desktop service may not be ready */ }
  const base = explicit ?? envBase ?? native ?? (import.meta.env.DEV ? "http://localhost:8080" : null);
  if (!base) throw new Error("Misty server URL is not configured.");
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

function normalizeBase(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\/+$/, "") : null;
}

export async function spaceRequest<T = void>(path: string, init?: RequestInit): Promise<T> {
  const [base, token] = await Promise.all([resolveSpacesApiBase(), readAccountAuthToken()]);
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { credentials: "include", ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let code: string | undefined;
    try { code = (JSON.parse(text) as { code?: string }).code; } catch { /* plain-text response */ }
    throw new SpaceRequestError(spaceErrorMessage(code, text), response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function spaceErrorMessage(code: string | undefined, fallback: string): string {
  const messages: Record<string, string> = {
    not_authenticated: "Your Misty session is unavailable. Sign out, then sign in again before creating a Space.",
    forbidden: "You no longer have access to this Space.",
    not_found: "That Space item no longer exists.",
    space_limit_reached: "This account has reached its Space limit.",
    space_people_limit_reached: "This Space already has five members or pending invitations.",
    space_node_limit_reached: "This Space has reached its 5,000-item limit.",
    version_conflict: "Someone else changed this item. Reload it before saving again.",
    invite_expired: "That invitation has expired.",
    invalid_request: "Misty could not validate that request.",
  };
  return code && messages[code] ? messages[code] : fallback.trim() || "The Space request failed.";
}

export const spacesApi = {
  snapshot: () => spaceRequest<SpacesSnapshot>("/spaces"),
  create: (name: string) => spaceRequest<Space>("/spaces", { method: "POST", body: JSON.stringify({ name }) }),
  rename: (spaceId: string, name: string) => spaceRequest<Space>(`/spaces/${encodeURIComponent(spaceId)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  delete: (spaceId: string, confirmation: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}`, { method: "DELETE", body: JSON.stringify({ confirmation }) }),
  members: (spaceId: string) => spaceRequest<{ members: SpaceMember[] }>(`/spaces/${encodeURIComponent(spaceId)}/members`),
  invite: (spaceId: string, email: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/invitations`, { method: "POST", body: JSON.stringify({ email }) }),
  respondInvite: (inviteId: string, accept: boolean) => spaceRequest(`/spaces/invitations/${encodeURIComponent(inviteId)}/${accept ? "accept" : "decline"}`, { method: "POST" }),
  removeMember: (spaceId: string, userId: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  leave: (spaceId: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/leave`, { method: "POST" }),
  transfer: (spaceId: string, userId: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/transfer`, { method: "POST", body: JSON.stringify({ user_id: userId }) }),
  messages: (spaceId: string, before = 0) => spaceRequest<{ messages: SpaceMessage[] }>(`/spaces/${encodeURIComponent(spaceId)}/messages?before=${before}&limit=50`),
  sendMessage: (spaceId: string, content: MessageSpan[], fileNodeIds: string[] = []) => spaceRequest<{ message: SpaceMessage; agent_replies: SpaceMessage[] }>(`/spaces/${encodeURIComponent(spaceId)}/messages`, { method: "POST", body: JSON.stringify({ content, file_node_ids: fileNodeIds }) }),
  updateMessage: (spaceId: string, messageId: string, content: MessageSpan[], fileNodeIds: string[] = []) => spaceRequest<SpaceMessage>(`/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}`, { method: "PUT", body: JSON.stringify({ content, file_node_ids: fileNodeIds }) }),
  deleteMessage: (spaceId: string, messageId: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
  markRead: (spaceId: string, seq: number) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/read`, { method: "POST", body: JSON.stringify({ seq }) }),
  nodes: (spaceId: string) => spaceRequest<{ nodes: SpaceNode[] }>(`/spaces/${encodeURIComponent(spaceId)}/nodes`),
  createNode: (spaceId: string, body: Record<string, unknown>) => spaceRequest<SpaceNode>(`/spaces/${encodeURIComponent(spaceId)}/nodes`, { method: "POST", body: JSON.stringify(body) }),
  updateNode: (spaceId: string, nodeId: string, body: Record<string, unknown>) => spaceRequest<SpaceNode>(`/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteNode: (spaceId: string, nodeId: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" }),
  resolve: (spaceId: string, nodeId: string, disposition: "open" | "download") => spaceRequest<{ ticket: string; url: string; expires_in: number }>(`/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeId)}/resolve`, { method: "POST", body: JSON.stringify({ disposition }) }),
  inbox: (tab: "unreads" | "mentions") => spaceRequest<{ items: SpaceInboxItem[] }>(`/activity/inbox?tab=${tab}`),
  seen: () => spaceRequest("/activity/inbox/seen", { method: "POST" }),
  clearInbox: (tab: "unreads" | "mentions") => spaceRequest("/activity/inbox/clear", { method: "POST", body: JSON.stringify({ tab }) }),
  studio: (spaceId: string, kind: "agents" | "workflows") => spaceRequest<{ resources: SpaceStudioResource[] }>(`/spaces/${encodeURIComponent(spaceId)}/studio/${kind}`),
  saveStudio: (spaceId: string, kind: "agents" | "workflows", item: Partial<SpaceStudioResource>) => spaceRequest<SpaceStudioResource>(`/spaces/${encodeURIComponent(spaceId)}/studio/${kind}`, { method: "POST", body: JSON.stringify(item) }),
  deleteStudio: (spaceId: string, kind: "agents" | "workflows", id: string) => spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/studio/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runStudio: (spaceId: string, kind: "agents" | "workflows", id: string, prompt = "") => spaceRequest<SpaceRun>(`/spaces/${encodeURIComponent(spaceId)}/studio/${kind}/${encodeURIComponent(id)}/runs`, { method: "POST", body: JSON.stringify({ prompt, input: { prompt } }) }),
  realtimeTicket: (after: number) => spaceRequest<{ ticket: string; expires_in: number }>("/realtime/tickets", { method: "POST", body: JSON.stringify({ after }) }),
};

export type RealtimeEnvelope =
  | { type: "replay"; events: SpaceEvent[]; resync_required: boolean }
  | { type: "event"; event: SpaceEvent }
  | { type: "control"; action: "member.removed" | "member.left" | "space.deleted"; space_id: string };
