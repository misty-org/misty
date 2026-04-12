import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/openExternalLink", () => ({
  openExternalLink: vi.fn(async () => {}),
}));

import { createMistyNativeNotesConnector } from "@/features/notes/connectors/mistyNativeNotes";
import { createNotionConnector } from "@/features/notes/connectors/notion";
import {
  createDefaultNotesRegistry,
  NotesConnectorRegistry,
} from "@/features/notes/connectors/registry";
import { createFakeNotionClient, notionPage } from "./fakeNotionClient";

const spaceInput = { spaceId: "space-product", spaceName: "Product" };

describe("MistyNativeNotesConnector", () => {
  it("is always connected and accepts writes", async () => {
    const connector = createMistyNativeNotesConnector();
    expect(connector.status()).toBe("connected");
    expect(connector.createNote).toBeTypeOf("function");
    expect(connector.updateNote).toBeTypeOf("function");
  });

  it("creates notes as local-only until synced", async () => {
    const connector = createMistyNativeNotesConnector();
    const created = await connector.createNote!({
      title: "Draft",
      body: "hello world",
      ...spaceInput,
    });

    expect(created.source).toBe("misty");
    expect(created.syncStatus).toBe("local-only");
    expect(created.preview).toBe("hello world");
    expect(created.spaceId).toBe(spaceInput.spaceId);
    expect(await connector.getNote(created.sourceId)).toMatchObject({ title: "Draft" });
  });

  it("falls back to a placeholder title", async () => {
    const connector = createMistyNativeNotesConnector();
    const created = await connector.createNote!({ title: "   ", body: "", ...spaceInput });
    expect(created.title).toBe("Untitled note");
  });

  it("requires every new note to belong to a Space", async () => {
    const connector = createMistyNativeNotesConnector();
    await expect(connector.createNote!({ title: "Loose", body: "" })).rejects.toThrow(
      /belong to a Space/,
    );
  });

  it("regenerates the preview when the body changes", async () => {
    const connector = createMistyNativeNotesConnector();
    const created = await connector.createNote!({ title: "Draft", body: "first", ...spaceInput });
    const updated = await connector.updateNote!(created.sourceId, { body: "## second body" });

    expect(updated.preview).toBe("second body");
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it("stores BlockNote JSON while keeping markdown available for previews", async () => {
    const connector = createMistyNativeNotesConnector();
    const body = JSON.stringify([
      {
        id: "block-1",
        type: "paragraph",
        props: {},
        content: "hello **blocks**",
        children: [],
      },
    ]);

    const created = await connector.createNote!({
      title: "Draft",
      body,
      bodyFormat: "blocknote-json",
      bodyMarkdown: "hello **blocks**",
      ...spaceInput,
    });

    expect(created.body).toBe(body);
    expect(created.bodyFormat).toBe("blocknote-json");
    expect(created.bodyMarkdown).toBe("hello **blocks**");
    expect(created.preview).toBe("hello blocks");
  });

  it("drops unlinked notes from account storage during native beta load", async () => {
    const storageKey = "misty.notes.native.v1.account-with-loose-notes";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "misty:loose",
          source: "misty",
          sourceId: "loose",
          title: "Loose",
          body: "hidden",
          bodyFormat: "markdown",
          preview: "hidden",
          tags: [],
          backlinks: [],
          updatedAt: "2026-07-20T12:00:00.000Z",
          createdAt: "2026-07-20T12:00:00.000Z",
          favorite: false,
          syncStatus: "local-only",
        },
        {
          id: "misty:space",
          source: "misty",
          sourceId: "space",
          title: "Space",
          body: "visible",
          bodyFormat: "markdown",
          preview: "visible",
          spaceId: spaceInput.spaceId,
          spaceName: spaceInput.spaceName,
          tags: [],
          backlinks: [],
          updatedAt: "2026-07-20T12:00:00.000Z",
          createdAt: "2026-07-20T12:00:00.000Z",
          favorite: false,
          syncStatus: "local-only",
        },
      ]),
    );

    const connector = createMistyNativeNotesConnector("account-with-loose-notes");
    const notes = await connector.listNotes();

    expect(notes.map((note) => note.title)).toEqual(["Space"]);
    expect(window.localStorage.getItem(storageKey)).not.toContain("Loose");
  });
});

describe("NotionConnector", () => {
  it("exposes write methods now that Notion is read/write", () => {
    const connector = createNotionConnector(createFakeNotionClient().client);
    expect(connector.capabilities.read).toBe(true);
    expect(connector.capabilities.create).toBe(true);
    expect(connector.createNote).toBeTypeOf("function");
    expect(connector.updateNote).toBeTypeOf("function");
    expect(connector.openInSource).toBeTypeOf("function");
  });

  it("starts disconnected until a connection is established", async () => {
    const connector = createNotionConnector(createFakeNotionClient().client);
    expect(connector.status()).toBe("disconnected");
    expect(await connector.listNotes()).toEqual([]);
    expect(connector.lastSyncedAt()).toBeUndefined();
  });

  it("reports connected once the provider confirms it", async () => {
    const connector = createNotionConnector(createFakeNotionClient({ connected: true }).client);
    await connector.connect();

    expect(connector.status()).toBe("connected");
    expect(connector.lastSyncedAt()).toBeDefined();
  });
});

describe("NotesConnectorRegistry", () => {
  it("registers only native Misty notes in the beta default registry", () => {
    const registry = createDefaultNotesRegistry("account-1");
    expect(registry.forSource("misty")?.providerId).toBe("misty");
    expect(registry.forSource("notion")).toBeUndefined();
    expect(registry.list().map((connector) => connector.providerId)).toEqual(["misty"]);
  });

  it("merges notes from every connector", async () => {
    const notion = createNotionConnector(
      createFakeNotionClient({ pages: { "page-1": notionPage("page-1", "Roadmap") } }).client,
      { initialStatus: "connected" },
    );
    await notion.selectSources!(["page-1"]);
    const registry = new NotesConnectorRegistry([createMistyNativeNotesConnector(), notion]);
    const { notes, errors } = await registry.listAllNotes();

    expect(errors).toEqual({});
    expect(notes.some((note) => note.source === "misty")).toBe(true);
    expect(notes.some((note) => note.source === "notion")).toBe(true);
  });

  it("isolates a failing connector instead of blanking the list", async () => {
    const healthy = createMistyNativeNotesConnector();
    const broken = createNotionConnector(createFakeNotionClient().client);
    broken.listNotes = async () => {
      throw new Error("token expired");
    };
    const registry = new NotesConnectorRegistry([healthy, broken]);

    const { notes, errors } = await registry.listAllNotes();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => note.source === "misty")).toBe(true);
    expect(errors[broken.id]).toBe("token expired");
  });

  it("resolves connectors by source", () => {
    const registry = new NotesConnectorRegistry([
      createMistyNativeNotesConnector(),
      createNotionConnector(createFakeNotionClient().client),
    ]);
    expect(registry.forSource("notion")?.providerId).toBe("notion");
    expect(registry.forSource("misty")?.providerId).toBe("misty");
  });
});
