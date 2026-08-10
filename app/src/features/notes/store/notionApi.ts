import { SpaceRequestError, spaceRequest } from "@/api/spaces/api";
import type {
  NoteWriteError,
  NotionAppendPayload,
  NotionBlock,
  NotionClient,
  NotionCreatePagePayload,
  NotionDatabase,
  NotionPage,
  NotionPropertyValue,
  NotionSourceOption,
} from "../model/interfaces/notion";
import type { NoteWriteErrorCode } from "../model/types/capabilities";

const part = encodeURIComponent;

/**
 * Notion credentials are stored per Space, so every proxied call is
 * Space-scoped. The Notes store sets this when it loads a Space; until then the
 * connector reports "not connected" rather than guessing at a workspace.
 */
let activeSpaceId = "";
let activeAccountId = "";

export function setNotionScope(accountId: string, spaceId: string): void {
  activeAccountId = accountId.trim();
  activeSpaceId = spaceId.trim();
}

/** The Space whose Notion connection is currently in use, if any. */
export function activeNotionSpaceId(): string {
  return activeSpaceId;
}

export function activeNotionAccountId(): string {
  return activeAccountId;
}

function notionPath(suffix: string): string {
  if (!activeSpaceId) throw notConnectedError();
  return `/spaces/${part(activeSpaceId)}/integrations/notion${suffix}`;
}

function notConnectedError(): NoteWriteError {
  const error = new Error("Open a Space to use Notion notes.") as NoteWriteError;
  error.code = "not_connected";
  return error;
}

/**
 * Notion transport backed by the Misty server.
 *
 * The Notion token is held server-side against the user's provider connection,
 * so the desktop client asks Misty for Notion data and never speaks to Notion
 * directly. That keeps the credential out of the renderer entirely.
 */
export function createNotionApiClient(): NotionClient {
  return {
    async isConnected() {
      try {
        if (!activeSpaceId) return false;
        const result = await spaceRequest<{ connected: boolean }>(notionPath("/status"));
        return result.connected;
      } catch {
        // A server that cannot answer is treated as "not connected" rather than
        // an error, so Notes still renders its other sources.
        return false;
      }
    },

    async connect() {
      if (!activeSpaceId) throw notConnectedError();
      const start = await spaceRequest<{ authorization_url: string }>(
        `/spaces/${part(activeSpaceId)}/integrations/notion/authorize`,
        { method: "POST", body: JSON.stringify({ return_to: `/spaces/${activeSpaceId}/notes` }) },
      );
      const { openExternalLink } = await import("@/shared/platform/openExternalLink");
      await openExternalLink(start.authorization_url);
    },

    disconnect: () => notionRequest<void>(notionPath("/connection"), { method: "DELETE" }),

    listSources: () =>
      notionRequest<{ sources: NotionSourceOption[] }>(notionPath("/sources")).then(
        (result) => result.sources,
      ),

    getPage: (pageId) => notionRequest<NotionPage>(notionPath(`/pages/${part(pageId)}`)),

    getPageBlocks: (pageId) =>
      notionRequest<{ blocks: NotionBlock[] }>(notionPath(`/pages/${part(pageId)}/blocks`)).then(
        (result) => result.blocks,
      ),

    queryDatabase: (databaseId) =>
      notionRequest<{ pages: NotionPage[] }>(notionPath(`/databases/${part(databaseId)}/query`), {
        method: "POST",
        body: JSON.stringify({}),
      }).then((result) => result.pages),

    getDatabase: (databaseId) =>
      notionRequest<NotionDatabase>(notionPath(`/databases/${part(databaseId)}`)),

    search: (query) =>
      notionRequest<{ pages: NotionPage[] }>(notionPath(`/search?q=${part(query)}`)).then(
        (result) => result.pages,
      ),

    createPage: (payload: NotionCreatePagePayload) =>
      notionRequest<NotionPage>(notionPath("/pages"), {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    appendBlocks: (payload: NotionAppendPayload) =>
      notionRequest<void>(notionPath(`/blocks/${part(payload.block_id)}/children`), {
        method: "PATCH",
        body: JSON.stringify({ children: payload.children }),
      }),

    updatePageProperties: (pageId: string, properties: Record<string, NotionPropertyValue>) =>
      notionRequest<NotionPage>(notionPath(`/pages/${part(pageId)}`), {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      }),
  };
}

/** Wraps transport failures in a coded error the UI can phrase calmly. */
async function notionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await spaceRequest<T>(path, init);
  } catch (reason) {
    throw toNoteWriteError(reason);
  }
}

export function toNoteWriteError(reason: unknown): NoteWriteError {
  const code = noteWriteErrorCode(reason);
  const error = new Error(noteWriteErrorMessage(code, reason)) as NoteWriteError;
  error.code = code;
  return error;
}

function noteWriteErrorCode(reason: unknown): NoteWriteErrorCode {
  if (!(reason instanceof SpaceRequestError)) return "unknown";
  if (reason.status === 401 || reason.code === "provider_token_missing") return "not_connected";
  if (reason.status === 403) return "permission_denied";
  if (reason.status === 404) return "not_found";
  if (reason.status === 409) return "conflict";
  if (reason.status === 429) return "rate_limited";
  if (reason.status === 400) return "unsupported_schema";
  return "unknown";
}

/** Notion's raw error bodies are not user-facing copy. */
export function noteWriteErrorMessage(code: NoteWriteErrorCode, reason?: unknown): string {
  const messages: Record<NoteWriteErrorCode, string> = {
    not_connected: "Connect Notion again to keep syncing these notes.",
    permission_denied:
      "Notion did not grant Misty access to that page. Share it with the Misty integration in Notion.",
    not_found: "That Notion page no longer exists.",
    unsupported_schema:
      "Misty could not match this Notion database's fields. Publishing was cancelled.",
    rate_limited: "Notion is rate limiting Misty. Try again in a moment.",
    conflict: "That Notion page changed while you were editing. Reload it before saving again.",
    unknown: "Misty could not reach Notion just now.",
  };
  if (code === "unknown" && reason instanceof Error && reason.message) return reason.message;
  return messages[code];
}
