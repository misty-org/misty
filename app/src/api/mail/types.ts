export interface MailAccount {
  connection_id: string;
  provider: string;
  account_id: string;
  email: string;
  display_name: string;
  total: number;
  unread: number;
  status?: string;
  error_code?: string;
}

export interface MailFolder {
  provider: string;
  provider_id: string;
  account_id: string;
  name: string;
  kind: string;
  system: boolean;
  total: number;
  unread: number;
  text_color?: string;
  background?: string;
}

export interface MailAddress {
  name?: string;
  email: string;
}

export interface MailAttachment {
  provider: string;
  provider_id: string;
  account_id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  inline: boolean;
  content_id?: string;
}

export interface MailMessageBody {
  text: string;
  html?: string;
  had_html: boolean;
  truncated: boolean;
}

export interface MailMessage {
  provider: string;
  provider_id: string;
  account_id: string;
  thread_id: string;
  rfc822_id?: string;
  subject: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  reply_to: MailAddress[];
  sent_at: string;
  snippet: string;
  body: MailMessageBody;
  labels: string[];
  unread: boolean;
  starred: boolean;
  draft: boolean;
  attachments: MailAttachment[];
}

export interface MailThread {
  provider: string;
  provider_id: string;
  account_id: string;
  subject: string;
  snippet: string;
  participants: MailAddress[];
  labels: string[];
  last_message_at: string;
  unread: boolean;
  starred: boolean;
  messages: MailMessage[];
}

export interface MailDraftInput {
  connection_id: string;
  thread_id?: string;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  reply_to?: MailAddress[];
  subject: string;
  text: string;
  attachments?: MailDraftAttachmentInput[];
}

export interface MailDraftAttachmentInput {
  filename: string;
  content_type: string;
  data: string;
  inline: boolean;
  content_id?: string;
}

export interface MailDraft {
  provider: string;
  provider_id: string;
  account_id: string;
  thread_id?: string;
  message: MailMessage;
}

export interface MailThreadAction {
  connection_id: string;
  read?: boolean;
  archived?: boolean;
  starred?: boolean;
}

export interface MailAccountsResponse {
  accounts: MailAccount[];
}

export interface MailFoldersResponse {
  folders: MailFolder[];
}

export interface MailThreadsResponse {
  threads: MailThread[];
  next_page_token?: string;
  estimated_total?: number;
}

export interface MailThreadResponse {
  thread: MailThread;
}

export interface MailThreadActionResponse {
  thread_id: string;
  added_labels: string[];
  removed_labels: string[];
}

export interface MailDraftResponse {
  draft: MailDraft;
}

export interface MailSendResponse {
  message: MailMessage;
}
