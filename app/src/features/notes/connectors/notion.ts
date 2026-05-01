import { openExternalLink } from "@/shared/platform/openExternalLink";
import { matchesQuery, nowIso, previewFrom } from "../connectorUtils";
import { NOTION_CONNECTOR_ID } from "../mockData";
import type {
  AppendNoteInput,
  NoteSourceOption,
  NotesConnector,
  PublishNoteInput,
  PublishNoteResult,
  SyncResult,
  UpdateNoteInput,
} from "../model/interfaces/connectors";
import type { NotionBlock, NotionClient, NotionPage } from "../model/interfaces/notion";
import type { NoteConnectorCapabilities } from "../model/types/capabilities";
import type { NoteProviderStatus, UnifiedNote } from "../model/types/types";
import {
  activeNotionAccountId,
  activeNotionSpaceId,
  createNotionApiClient,
  toNoteWriteError,
} from "../store/notionApi";
import {
  buildCreatePagePayload,
  buildPropertyPatch,
  chunkBlocks,
  markdownToNotionBlocks,
  notionBlocksToMarkdown,
  notionPageTitle,
  richText,
  taskListToNotionBlocks,
} from "./notionBlocks";

const NOTION_CAPABILITIES: NoteConnectorCapabilities = {
  read: true,
  create: true,
  append: true,
  update: false,
  delete: false,
  updateProperties: true,
  openInSource: true,
  sync: true,
  selectSources: true,
};

/**
 * Read/write Notion connector.
 *
 * Reads are scoped to the pages and databases a Space explicitly selects —
 * Misty never slurps a whole Notion workspace. Writes are structured: create a
 * page, append blocks, publish a Misty artifact, or set known properties. Free
 * editing of arbitrary Notion documents is deliberately out of beta scope.
 */
export function createNotionConnector(
  client: NotionClient = createNotionApiClient(),
  options: {
    initialStatus?: NoteProviderStatus;
    selectedSourceIds?: string[];
  } = {},
): NotesConnector {
  let status: NoteProviderStatus = options.initialStatus ?? "disconnected";
  let syncedAt: string | undefined;
  let selected = [...(options.selectedSourceIds ?? readSelectedSources())];
  let cache: UnifiedNote[] = [];
  /** Databases the notes came from, so property writes can read their schema. */
  const databaseOfPage = new Map<string, string>();

  /** One place to decide what a Notion failure does to connector status. */
  async function guard<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action();
      if (status === "error") status = "connected";
      return result;
    } catch (reason) {
      const error = toNoteWriteError(reason);
      status = error.code === "not_connected" ? "needs_reconnect" : "error";
      throw error;
    }
  }

  function toNote(page: NotionPage, blocks: NotionBlock[]): UnifiedNote {
    const body = notionBlocksToMarkdown(blocks);
    return {
      id: `notion:${page.id}`,
      source: "notion",
      sourceId: page.id,
      title: notionPageTitle(page),
      body,
      bodyFormat: "markdown",
      preview: previewFrom(body),
      tags: [],
      backlinks: [],
      updatedAt: page.last_edited_time ?? nowIso(),
      createdAt: page.created_time ?? page.last_edited_time ?? nowIso(),
      favorite: false,
      syncStatus: page.archived ? "error" : "synced",
      sourceUrl: page.url,
      connectorId: NOTION_CONNECTOR_ID,
      providerStatus: status,
    };
  }

  /** Loads one selected source — a single page, or every row of a database. */
  async function loadSource(sourceId: string): Promise<UnifiedNote[]> {
    const pages = await pagesForSource(sourceId);
    return Promise.all(
      pages.map(async (page) => toNote(page, await client.getPageBlocks(page.id))),
    );
  }

  async function pagesForSource(sourceId: string): Promise<NotionPage[]> {
    try {
      const rows = await client.queryDatabase(sourceId);
      rows.forEach((row) => databaseOfPage.set(row.id, sourceId));
      return rows;
    } catch {
      // Not a database (or not readable as one) — treat the id as a page.
      return [await client.getPage(sourceId)];
    }
  }

  async function refresh(): Promise<UnifiedNote[]> {
    if (status === "disconnected" || !selected.length) return [];
    // One unreadable source must not blank the others: a page the user lost
    // access to should cost that page, not the whole Notion section.
    const results = await Promise.allSettled(selected.map((id) => loadSource(id)));
    cache = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    return cache;
  }

  /** Resolves the page a write targets, defaulting to the first selection. */
  function resolveTarget(input: PublishNoteInput) {
    const targetId = input.targetId ?? selected[0];
    if (!targetId) throw new Error("Choose a Notion page or database to publish into.");
    return targetId;
  }

  return {
    id: NOTION_CONNECTOR_ID,
    providerId: "notion",
    name: "Notion",
    source: "notion",
    capabilities: NOTION_CAPABILITIES,

    status: () => status,
    lastSyncedAt: () => syncedAt,

    async connect() {
      status = "syncing";
      try {
        await client.connect();
        status = (await client.isConnected()) ? "connected" : "disconnected";
        if (status === "connected") syncedAt = nowIso();
      } catch (reason) {
        status = "error";
        throw toNoteWriteError(reason);
      }
    },

    async disconnect() {
      await client.disconnect().catch(() => undefined);
      status = "disconnected";
      syncedAt = undefined;
      selected = [];
      writeSelectedSources([]);
      cache = [];
    },

    async listNotes() {
      if (status === "disconnected") {
        // A connection already stored server-side should surface on its own;
        // making someone press Connect again after every reload would be wrong.
        status = (await client.isConnected()) ? "connected" : "disconnected";
        if (status === "disconnected") return [];
        selected = readSelectedSources();
      }
      return (await refresh()).map((note) => ({ ...note, providerStatus: status }));
    },

    async getNote(sourceId: string) {
      return guard(async () => {
        const page = await client.getPage(sourceId);
        return toNote(page, await client.getPageBlocks(sourceId));
      });
    },

    async searchNotes(query: string) {
      if (status === "disconnected") return [];
      // Search spans the whole workspace Misty can see, not just selections —
      // finding a page is how a user decides to subscribe to it.
      const pages = await guard(() => client.search(query));
      const notes = pages.map((page) => toNote(page, []));
      return notes.filter((note) => matchesQuery(note, query));
    },

    async listSources(): Promise<NoteSourceOption[]> {
      return guard(() => client.listSources());
    },

    selectedSourceIds: () => [...selected],

    async selectSources(sourceIds: string[]) {
      selected = [...new Set(sourceIds)];
      writeSelectedSources(selected);
      await refresh();
      syncedAt = nowIso();
    },

    async createNote(input) {
      return guard(async () => {
        const target = resolveTarget({ title: input.title, targetId: undefined });
        const page = await createPage(client, target, input.title, input.body);
        return toNote(page, markdownToNotionBlocks(input.body));
      });
    },

    /**
     * Rewrites a page by appending the new body. Notion has no "replace all
     * blocks" primitive Misty can use safely, so beta appends rather than
     * risking the destruction of blocks it never parsed.
     */
    async updateNote(sourceId: string, patch: UpdateNoteInput) {
      return guard(async () => {
        if (patch.title !== undefined) {
          await client.updatePageProperties(sourceId, {
            title: { type: "title", title: richText(patch.title) },
          });
        }
        if (patch.body) await appendMarkdown(client, sourceId, patch.body);
        const page = await client.getPage(sourceId);
        return toNote(page, await client.getPageBlocks(sourceId));
      });
    },

    async appendToNote(sourceId: string, input: AppendNoteInput) {
      return guard(async () => {
        await appendMarkdown(client, sourceId, input.body);
        const page = await client.getPage(sourceId);
        return toNote(page, await client.getPageBlocks(sourceId));
      });
    },

    async publishNote(input: PublishNoteInput): Promise<PublishNoteResult> {
      return guard(async () => {
        const targetId = resolveTarget(input);
        const blocks = publishBlocks(input);
        const { properties, skippedProperties } = await shapeProperties(client, input, targetId);

        if (input.targetKind === "page") {
          // Appending keeps an existing page's content intact.
          for (const batch of chunkBlocks(blocks)) {
            await client.appendBlocks({ block_id: targetId, children: batch });
          }
          const page = await client.getPage(targetId);
          return { note: toNote(page, await client.getPageBlocks(targetId)), skippedProperties };
        }

        const payload = buildCreatePagePayload({
          title: input.title,
          markdown: "",
          ...(input.targetKind === "database" || (await isDatabase(client, targetId))
            ? {
                parentDatabaseId: targetId,
                titlePropertyName: await titleProperty(client, targetId),
              }
            : { parentPageId: targetId }),
          properties,
        });
        const page = await client.createPage({ ...payload, children: blocks });
        return { note: toNote(page, blocks), skippedProperties };
      });
    },

    async updateProperties(sourceId, values) {
      return guard(async () => {
        const databaseId = databaseOfPage.get(sourceId);
        const schema = databaseId ? (await client.getDatabase(databaseId)).properties : undefined;
        const { properties, skipped } = buildPropertyPatch(schema, values);
        if (!Object.keys(properties).length) {
          const page = await client.getPage(sourceId);
          return { note: toNote(page, []), skippedProperties: skipped };
        }
        const page = await client.updatePageProperties(sourceId, properties);
        return { note: toNote(page, []), skippedProperties: skipped };
      });
    },

    async openInSource(sourceId: string) {
      const note = cache.find((candidate) => candidate.sourceId === sourceId);
      const url = note?.sourceUrl ?? `https://www.notion.so/${sourceId.replace(/-/g, "")}`;
      await openExternalLink(url);
    },

    async sync(): Promise<SyncResult> {
      if (status === "disconnected") {
        return {
          connectorId: NOTION_CONNECTOR_ID,
          syncedAt: nowIso(),
          noteCount: 0,
          error: "Notion is not connected.",
        };
      }
      status = "syncing";
      try {
        const notes = await refresh();
        status = "connected";
        syncedAt = nowIso();
        return { connectorId: NOTION_CONNECTOR_ID, syncedAt, noteCount: notes.length };
      } catch (reason) {
        const error = toNoteWriteError(reason);
        status = error.code === "not_connected" ? "needs_reconnect" : "error";
        syncedAt = nowIso();
        // A failed sync still returns the cached notes' count: the pane stays
        // readable and the problem is reported, not thrown at the user.
        return {
          connectorId: NOTION_CONNECTOR_ID,
          syncedAt,
          noteCount: cache.length,
          error: error.message,
        };
      }
    },
  };
}

/** Renders the Misty artifact being published into Notion blocks. */
function publishBlocks(input: PublishNoteInput): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  if (input.summary) {
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("Summary") } });
    blocks.push(...markdownToNotionBlocks(input.summary));
  }
  if (input.body) blocks.push(...markdownToNotionBlocks(input.body));
  if (input.tasks?.length) {
    blocks.push({ type: "heading_2", heading_2: { rich_text: richText("Tasks") } });
    blocks.push(...taskListToNotionBlocks(input.tasks));
  }
  return blocks;
}

async function shapeProperties(client: NotionClient, input: PublishNoteInput, targetId: string) {
  if (!input.properties) return { properties: undefined, skippedProperties: [] };
  try {
    const database = await client.getDatabase(targetId);
    const patch = buildPropertyPatch(database.properties, input.properties);
    return { properties: patch.properties, skippedProperties: patch.skipped };
  } catch {
    // Publishing into a plain page: there is no schema, so every requested
    // property is reported as skipped instead of being invented.
    return { properties: undefined, skippedProperties: Object.keys(input.properties) };
  }
}

async function createPage(
  client: NotionClient,
  targetId: string,
  title: string,
  markdown: string,
): Promise<NotionPage> {
  const database = await isDatabase(client, targetId);
  return client.createPage(
    buildCreatePagePayload({
      title,
      markdown,
      ...(database
        ? { parentDatabaseId: targetId, titlePropertyName: await titleProperty(client, targetId) }
        : { parentPageId: targetId }),
    }),
  );
}

async function appendMarkdown(client: NotionClient, pageId: string, markdown: string) {
  for (const batch of chunkBlocks(markdownToNotionBlocks(markdown))) {
    await client.appendBlocks({ block_id: pageId, children: batch });
  }
}

async function isDatabase(client: NotionClient, id: string): Promise<boolean> {
  try {
    await client.getDatabase(id);
    return true;
  } catch {
    return false;
  }
}

/** A database's title column is not always called "Name". */
async function titleProperty(client: NotionClient, databaseId: string): Promise<string> {
  try {
    const database = await client.getDatabase(databaseId);
    const entry = Object.entries(database.properties ?? {}).find(
      ([, property]) => property.type === "title",
    );
    return entry?.[0] ?? "Name";
  } catch {
    return "Name";
  }
}

/**
 * Selected sources are remembered locally so a reload does not silently empty
 * the Notes pane. They are a per-device view preference, not shared Space
 * state, which is why they are not written back to the server.
 */
function selectionKey(): string {
  const accountId = activeNotionAccountId();
  const spaceId = activeNotionSpaceId();
  return accountId && spaceId
    ? `misty.notes.notion.sources.${encodeURIComponent(accountId)}.${encodeURIComponent(spaceId)}`
    : "";
}

function readSelectedSources(): string[] {
  const key = selectionKey();
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeSelectedSources(sourceIds: string[]): void {
  const key = selectionKey();
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(sourceIds));
  } catch {
    // A storage quota or privacy-mode failure must not break note reading.
  }
}
