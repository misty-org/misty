import { apiRequest } from "@/api/client";
import type {
  MailAccountsResponse,
  MailDraftInput,
  MailDraftResponse,
  MailFoldersResponse,
  MailSendResponse,
  MailThreadAction,
  MailThreadActionResponse,
  MailThreadResponse,
  MailThreadsResponse,
} from "./types";

const part = encodeURIComponent;

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export const mailApi = {
  accounts: () => apiRequest<MailAccountsResponse>("/mail/accounts"),
  folders: (connectionId: string) =>
    apiRequest<MailFoldersResponse>(`/mail/folders${query({ connection_id: connectionId })}`),
  threads: (input: {
    connectionId: string;
    folderId?: string;
    query?: string;
    pageToken?: string;
    pageSize?: number;
  }) =>
    apiRequest<MailThreadsResponse>(
      `/mail/threads${query({
        connection_id: input.connectionId,
        folder_id: input.folderId,
        query: input.query,
        page_token: input.pageToken,
        page_size: input.pageSize ?? 40,
      })}`,
    ),
  thread: (connectionId: string, threadId: string) =>
    apiRequest<MailThreadResponse>(
      `/mail/threads/${part(threadId)}${query({ connection_id: connectionId })}`,
    ),
  actOnThread: (threadId: string, action: MailThreadAction) =>
    apiRequest<MailThreadActionResponse>(`/mail/threads/${part(threadId)}/actions`, {
      method: "POST",
      body: JSON.stringify(action),
    }),
  createDraft: (draft: MailDraftInput) =>
    apiRequest<MailDraftResponse>("/mail/drafts", {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  updateDraft: (draftId: string, draft: MailDraftInput) =>
    apiRequest<MailDraftResponse>(`/mail/drafts/${part(draftId)}`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),
  sendDraft: (draftId: string, connectionId: string) =>
    apiRequest<MailSendResponse>(`/mail/drafts/${part(draftId)}/send`, {
      method: "POST",
      body: JSON.stringify({
        connection_id: connectionId,
        authoring_source: "user",
        confirmed: true,
      }),
    }),
};
