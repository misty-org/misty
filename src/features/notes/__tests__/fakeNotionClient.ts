import { vi } from "vitest";

import { richText } from "../connectors/notionBlocks";
import type {
  NotionAppendPayload,
  NotionBlock,
  NotionClient,
  NotionCreatePagePayload,
  NotionDatabase,
  NotionPage,
  NotionPropertyValue,
  NotionSourceOption,
} from "../model/interfaces/notion";

export interface FakeNotionOptions {
  pages?: Record<string, NotionPage>;
  blocks?: Record<string, NotionBlock[]>;
  databases?: Record<string, NotionDatabase>;
  databaseRows?: Record<string, NotionPage[]>;
  sources?: NotionSourceOption[];
  connected?: boolean;
}

/**
 * In-memory stand-in for the server-proxied Notion transport, so connector
 * behaviour can be tested without a Notion workspace. Calls are spies, which is
 * what lets the tests assert on the exact payloads Misty would send.
 */
export function createFakeNotionClient(options: FakeNotionOptions = {}) {
  const pages: Record<string, NotionPage> = { ...options.pages };
  const blocks: Record<string, NotionBlock[]> = { ...options.blocks };
  const databases: Record<string, NotionDatabase> = { ...options.databases };
  const databaseRows: Record<string, NotionPage[]> = { ...options.databaseRows };
  let connected = options.connected ?? true;
  let createdCounter = 0;

  const client = {
    isConnected: vi.fn(async () => connected),
    connect: vi.fn(async () => {
      connected = true;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
    }),
    listSources: vi.fn(async () => options.sources ?? []),
    getPage: vi.fn(async (pageId: string) => {
      const page = pages[pageId];
      if (!page) throw notFound(`page ${pageId}`);
      return page;
    }),
    getPageBlocks: vi.fn(async (pageId: string) => blocks[pageId] ?? []),
    queryDatabase: vi.fn(async (databaseId: string) => {
      if (!databaseRows[databaseId]) throw notFound(`database ${databaseId}`);
      return databaseRows[databaseId];
    }),
    getDatabase: vi.fn(async (databaseId: string) => {
      const database = databases[databaseId];
      if (!database) throw notFound(`database ${databaseId}`);
      return database;
    }),
    search: vi.fn(async () => Object.values(pages)),
    createPage: vi.fn(async (payload: NotionCreatePagePayload) => {
      createdCounter += 1;
      const id = `created-page-${createdCounter}`;
      const created: NotionPage = {
        id,
        url: `https://www.notion.so/${id}`,
        created_time: "2026-07-20T12:00:00.000Z",
        last_edited_time: "2026-07-20T12:00:00.000Z",
        properties: payload.properties as NotionPage["properties"],
      };
      pages[id] = created;
      blocks[id] = payload.children;
      return created;
    }),
    appendBlocks: vi.fn(async (payload: NotionAppendPayload) => {
      blocks[payload.block_id] = [...(blocks[payload.block_id] ?? []), ...payload.children];
    }),
    updatePageProperties: vi.fn(
      async (pageId: string, properties: Record<string, NotionPropertyValue>) => {
        const page = pages[pageId];
        if (!page) throw notFound(`page ${pageId}`);
        pages[pageId] = { ...page, properties: { ...page.properties, ...properties } };
        return pages[pageId];
      },
    ),
  };
  // Keeps the spy types visible to tests while still proving the shape matches.
  client satisfies NotionClient;

  return { client, pages, blocks };
}

export function notionPage(
  id: string,
  title: string,
  overrides: Partial<NotionPage> = {},
): NotionPage {
  return {
    id,
    url: `https://www.notion.so/${id}`,
    created_time: "2026-07-01T00:00:00.000Z",
    last_edited_time: "2026-07-19T00:00:00.000Z",
    properties: { Name: { type: "title", title: richText(title) } },
    ...overrides,
  };
}

function notFound(what: string) {
  return new Error(`Notion could not find ${what}`);
}
