import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn(async () => {}) }));

import { openExternalLink } from "@/shared/platform/openExternalLink";
import { createNotionConnector } from "../connectors/notion";
import { plainText } from "../connectors/notionBlocks";
import { createFakeNotionClient, notionPage } from "./fakeNotionClient";

function connectedConnector(options: Parameters<typeof createFakeNotionClient>[0] = {}) {
  const fake = createFakeNotionClient(options);
  const connector = createNotionConnector(fake.client, {
    initialStatus: "connected",
    selectedSourceIds: options.sources?.map((source) => source.id),
  });
  return { ...fake, connector };
}

describe("Notion connector capabilities", () => {
  it("announces supported writes without presenting append as document replacement", () => {
    const { connector } = connectedConnector();
    expect(connector.capabilities).toEqual({
      read: true,
      create: true,
      append: true,
      update: false,
      delete: false,
      updateProperties: true,
      openInSource: true,
      sync: true,
      selectSources: true,
    });
    expect(connector.createNote).toBeTypeOf("function");
    expect(connector.appendToNote).toBeTypeOf("function");
    expect(connector.publishNote).toBeTypeOf("function");
  });
});

describe("Notion connector reads", () => {
  it("serves nothing while disconnected", async () => {
    const { connector } = connectedConnector();
    await connector.disconnect();
    expect(await connector.listNotes()).toEqual([]);
    expect(connector.lastSyncedAt()).toBeUndefined();
  });

  it("reads only the sources a Space selected", async () => {
    const { client, connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Roadmap") },
      blocks: { "page-1": [{ type: "heading_1", heading_1: { rich_text: [] } }] },
    });
    await connector.selectSources!(["page-1"]);
    const notes = await connector.listNotes();

    expect(notes.map((note) => note.title)).toEqual(["Roadmap"]);
    expect(notes[0].source).toBe("notion");
    expect(notes[0].sourceUrl).toBe("https://www.notion.so/page-1");
    expect(client.getPage).toHaveBeenCalledWith("page-1");
  });

  it("expands a selected database into one note per row", async () => {
    const { connector } = connectedConnector({
      databaseRows: {
        "db-1": [notionPage("row-1", "First"), notionPage("row-2", "Second")],
      },
      databases: { "db-1": { id: "db-1", properties: { Name: { type: "title" } } } },
    });
    await connector.selectSources!(["db-1"]);
    expect((await connector.listNotes()).map((note) => note.title)).toEqual(["First", "Second"]);
  });

  it("keeps readable sources when one is permission-denied", async () => {
    const { connector } = connectedConnector({
      pages: { "page-ok": notionPage("page-ok", "Readable") },
    });
    await connector.selectSources!(["page-ok", "page-denied"]);
    const notes = await connector.listNotes();

    expect(notes.map((note) => note.title)).toEqual(["Readable"]);
  });

  it("converts page blocks into markdown", async () => {
    const { connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Notes") },
      blocks: {
        "page-1": [
          {
            type: "heading_2",
            heading_2: { rich_text: [{ type: "text", text: { content: "Agenda" } }] },
          },
          {
            type: "to_do",
            to_do: { rich_text: [{ type: "text", text: { content: "Ship" } }], checked: true },
          },
        ],
      },
    });
    await connector.selectSources!(["page-1"]);
    const [note] = await connector.listNotes();

    expect(note.bodyFormat).toBe("markdown");
    expect(note.body).toContain("## Agenda");
    expect(note.body).toContain("- [x] Ship");
    expect(note.preview).toContain("Agenda");
  });
});

describe("Notion connector writes", () => {
  it("creates a page under the selected parent", async () => {
    const { client, connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Parent") },
    });
    await connector.selectSources!(["page-1"]);
    const created = await connector.createNote!({ title: "New note", body: "- a bullet" });

    expect(client.createPage).toHaveBeenCalledTimes(1);
    const payload = client.createPage.mock.calls[0][0];
    expect(payload.parent).toEqual({ page_id: "page-1" });
    expect(payload.children.map((block) => block.type)).toEqual(["bulleted_list_item"]);
    expect(created.source).toBe("notion");
  });

  it("appends without rewriting what it never parsed", async () => {
    const { client, connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Log") },
      blocks: { "page-1": [{ type: "paragraph", paragraph: { rich_text: [] } }] },
    });
    await connector.appendToNote!("page-1", { body: "## Update\n\nShipped." });

    expect(client.appendBlocks).toHaveBeenCalledTimes(1);
    const payload = client.appendBlocks.mock.calls[0][0];
    expect(payload.block_id).toBe("page-1");
    expect(payload.children.map((block) => block.type)).toEqual(["heading_2", "paragraph"]);
  });

  it("publishes a summary and task list as structured blocks", async () => {
    const { client, connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Weekly") },
    });
    await connector.publishNote!({
      title: "Week 30",
      summary: "Beta integrations landed.",
      tasks: [
        { title: "Discord mirror", done: true },
        { title: "Notion write-back", done: false },
      ],
      targetId: "page-1",
    });

    const payload = client.createPage.mock.calls[0][0];
    expect(payload.children.map((block) => block.type)).toEqual([
      "heading_2",
      "paragraph",
      "heading_2",
      "to_do",
      "to_do",
    ]);
    expect(plainText(payload.children[3].to_do?.rich_text)).toBe("Discord mirror");
    expect(payload.children[3].to_do?.checked).toBe(true);
  });

  it("appends to an existing page when the target is a page", async () => {
    const { client, connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Weekly") },
    });
    await connector.publishNote!({
      title: "Week 30",
      body: "All green.",
      targetId: "page-1",
      targetKind: "page",
    });

    expect(client.appendBlocks).toHaveBeenCalledTimes(1);
    expect(client.createPage).not.toHaveBeenCalled();
  });

  it("reports properties the target schema could not accept", async () => {
    const { connector } = connectedConnector({
      databases: {
        "db-1": { id: "db-1", properties: { Name: { type: "title" }, Owner: { type: "people" } } },
      },
      databaseRows: { "db-1": [] },
    });
    const result = await connector.publishNote!({
      title: "Row",
      targetId: "db-1",
      targetKind: "database",
      properties: { Owner: "someone" },
    });

    expect(result.skippedProperties).toEqual(["Owner"]);
  });

  it("refuses to publish with no target chosen", async () => {
    const { connector } = connectedConnector();
    await expect(connector.publishNote!({ title: "x" })).rejects.toThrow(
      /Choose a Notion page or database/,
    );
  });

  it("batches an append past Notion's 100-child limit", async () => {
    const { client, connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Log") },
    });
    const body = Array.from({ length: 150 }, (_, index) => `- item ${index}`).join("\n");
    await connector.appendToNote!("page-1", { body });

    expect(client.appendBlocks).toHaveBeenCalledTimes(2);
    expect(client.appendBlocks.mock.calls[0][0].children).toHaveLength(100);
    expect(client.appendBlocks.mock.calls[1][0].children).toHaveLength(50);
  });
});

describe("Notion connector failure handling", () => {
  it("reports a sync problem instead of throwing at the user", async () => {
    const { client, connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Roadmap") },
    });
    await connector.selectSources!(["page-1"]);
    client.getPage.mockRejectedValueOnce(new Error("Notion is unavailable"));
    client.queryDatabase.mockRejectedValueOnce(new Error("not a database"));

    const result = await connector.sync!();
    expect(result.connectorId).toBe(connector.id);
    expect(result.error).toBeUndefined();
    expect(result.noteCount).toBe(0);
  });

  it("says Notion is not connected rather than failing silently", async () => {
    const { connector } = connectedConnector();
    await connector.disconnect();

    const result = await connector.sync!();
    expect(result.error).toBe("Notion is not connected.");
    expect(result.noteCount).toBe(0);
  });

  it("opens the page in Notion", async () => {
    const { connector } = connectedConnector({
      pages: { "page-1": notionPage("page-1", "Roadmap") },
    });
    await connector.selectSources!(["page-1"]);
    await connector.openInSource!("page-1");

    expect(openExternalLink).toHaveBeenCalledWith("https://www.notion.so/page-1");
  });
});

describe("Notion connector connection recovery", () => {
  it("adopts an existing server-side connection without asking to reconnect", async () => {
    const fake = createFakeNotionClient({
      connected: true,
      pages: { "page-1": notionPage("page-1", "Roadmap") },
    });
    // A fresh connector starts disconnected; the stored connection should
    // surface on first read rather than after a manual Connect.
    const connector = createNotionConnector(fake.client);
    expect(connector.status()).toBe("disconnected");

    await connector.listNotes();
    expect(fake.client.isConnected).toHaveBeenCalled();
    expect(connector.status()).toBe("connected");
  });

  it("stays disconnected when the server has no connection", async () => {
    const fake = createFakeNotionClient({ connected: false });
    const connector = createNotionConnector(fake.client);

    expect(await connector.listNotes()).toEqual([]);
    expect(connector.status()).toBe("disconnected");
  });
});
