import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/openExternalLink", () => ({
  openExternalLink: vi.fn(async () => {}),
}));

import { createMistyNativeNotesConnector } from "@/features/notes/connectors/mistyNativeNotes";
import { createNotionConnector } from "@/features/notes/connectors/notion";
import { NotesConnectorRegistry } from "@/features/notes/connectors/registry";
import { createFakeNotionClient, notionPage } from "./fakeNotionClient";

describe("MistyNativeNotesConnector", () => {
  it("is always connected and accepts writes", async () => {
    const connector = createMistyNativeNotesConnector();
    expect(connector.status()).toBe("connected");
    expect(connector.createNote).toBeTypeOf("function");
    expect(connector.updateNote).toBeTypeOf("function");
  });

  it("creates notes as local-only until synced", async () => {
    const connector = createMistyNativeNotesConnector();
    const created = await connector.createNote!({ title: "Draft", body: "hello world" });

    expect(created.source).toBe("misty");
    expect(created.syncStatus).toBe("local-only");
    expect(created.preview).toBe("hello world");
    expect(await connector.getNote(created.sourceId)).toMatchObject({ title: "Draft" });
  });

  it("falls back to a placeholder title", async () => {
    const connector = createMistyNativeNotesConnector();
    const created = await connector.createNote!({ title: "   ", body: "" });
    expect(created.title).toBe("Untitled note");
  });

  it("regenerates the preview when the body changes", async () => {
    const connector = createMistyNativeNotesConnector();
    const created = await connector.createNote!({ title: "Draft", body: "first" });
    const updated = await connector.updateNote!(created.sourceId, { body: "## second body" });

    expect(updated.preview).toBe("second body");
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
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
