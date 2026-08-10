import type { NoteSourceKind, NoteWriteErrorCode } from "../types/capabilities";

/**
 * Notion wire shapes, narrowed to what Misty reads and writes. Beta covers the
 * common block set; anything else round-trips as an unsupported placeholder
 * rather than being silently dropped or mangled.
 */

export interface NotionRichText {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: Partial<{
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
  }>;
  plain_text?: string;
}

export type NotionBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "quote"
  | "code"
  | "divider";

export interface NotionBlock {
  object?: "block";
  id?: string;
  type: NotionBlockType;
  paragraph?: { rich_text: NotionRichText[] };
  heading_1?: { rich_text: NotionRichText[] };
  heading_2?: { rich_text: NotionRichText[] };
  heading_3?: { rich_text: NotionRichText[] };
  bulleted_list_item?: { rich_text: NotionRichText[] };
  numbered_list_item?: { rich_text: NotionRichText[] };
  to_do?: { rich_text: NotionRichText[]; checked: boolean };
  quote?: { rich_text: NotionRichText[] };
  code?: { rich_text: NotionRichText[]; language: string };
  divider?: Record<string, never>;
}

/** A Notion property value, limited to the simple types Misty will write. */
export type NotionPropertyValue =
  | { type: "title"; title: NotionRichText[] }
  | { type: "rich_text"; rich_text: NotionRichText[] }
  | { type: "select"; select: { name: string } | null }
  | { type: "multi_select"; multi_select: Array<{ name: string }> }
  | { type: "date"; date: { start: string; end?: string | null } | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "number"; number: number | null }
  | { type: "url"; url: string | null };

export interface NotionPage {
  id: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  parent?: { type?: string; page_id?: string; database_id?: string; workspace?: boolean };
  properties?: Record<string, NotionPropertyValue & { id?: string }>;
  /** Present on search results for pages titled outside a database. */
  title?: NotionRichText[];
}

export interface NotionDatabase {
  id: string;
  url?: string;
  title?: NotionRichText[];
  /** Property name → declared type, used to reject writes Misty cannot shape. */
  properties?: Record<string, { id?: string; type: string }>;
}

/** A Notion page or database offered to a Space as a note source. */
export interface NotionSourceOption {
  id: string;
  kind: NoteSourceKind;
  title: string;
  url?: string;
  /** Breadcrumb-ish parent label, so two "Notes" pages are distinguishable. */
  parentTitle?: string;
}

/** Payload for creating a Notion page. Exactly one parent must be set. */
export interface NotionCreatePagePayload {
  parent: { page_id: string } | { database_id: string };
  properties: Record<string, NotionPropertyValue>;
  children: NotionBlock[];
}

/** Payload for appending blocks to an existing page. */
export interface NotionAppendPayload {
  block_id: string;
  children: NotionBlock[];
}

/**
 * Notion transport. The desktop client never holds a Notion token — every call
 * is proxied by the Misty server, which owns the credential.
 */
export interface NotionClient {
  isConnected(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Pages and databases the Misty integration can see. */
  listSources(): Promise<NotionSourceOption[]>;
  getPage(pageId: string): Promise<NotionPage>;
  getPageBlocks(pageId: string): Promise<NotionBlock[]>;
  queryDatabase(databaseId: string): Promise<NotionPage[]>;
  getDatabase(databaseId: string): Promise<NotionDatabase>;
  search(query: string): Promise<NotionPage[]>;
  createPage(payload: NotionCreatePagePayload): Promise<NotionPage>;
  appendBlocks(payload: NotionAppendPayload): Promise<void>;
  updatePageProperties(
    pageId: string,
    properties: Record<string, NotionPropertyValue>,
  ): Promise<NotionPage>;
}

/** A write Notion refused, carrying a code the UI can phrase calmly. */
export interface NoteWriteError extends Error {
  code: NoteWriteErrorCode;
}
