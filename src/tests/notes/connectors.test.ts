import { beforeEach, describe, expect, it, vi } from "vitest";

const spaceRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/platform/openExternalLink", () => ({
  openExternalLink: vi.fn(async () => {}),
}));

vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
  spaceRequest: spaceRequestMock,
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
  beforeEach(() => {
    spaceRequestMock.mockReset();
  });

  it("is always connected and accepts writes", async () => {
    const connector = createMistyNativeNotesConnector();
    expect(connector.status()).toBe("connected");
    expect(connector.createNote).toBeTypeOf("function");
    expect(connector.deleteNote).toBeTypeOf("function");
    expect(connector.capabilities.delete).toBe(true);
    expect(connector.capabilities.update).toBe(false);
  });

  it("creates notes through the Space API as synced collaborative notes", async () => {
    spaceRequestMock.mockResolvedValueOnce(
      serverNote({ title: "Draft", plain_text: "hello world" }),
    );
    const connector = createMistyNativeNotesConnector(
      "account",
      spaceInput.spaceId,
      spaceInput.spaceName,
    );
    const created = await connector.createNote!({
      title: "Draft",
      body: "hello world",
      ...spaceInput,
    });

    expect(spaceRequestMock).toHaveBeenCalledWith("/spaces/space-product/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Draft" }),
    });
    expect(created.source).toBe("misty");
    expect(created.syncStatus).toBe("synced");
    expect(created.preview).toBe("hello world");
    expect(created.spaceId).toBe(spaceInput.spaceId);
  });

  it("falls back to a placeholder title", async () => {
    spaceRequestMock.mockResolvedValueOnce(serverNote({ title: "Untitled note" }));
    const connector = createMistyNativeNotesConnector(
      "account",
      spaceInput.spaceId,
      spaceInput.spaceName,
    );
    const created = await connector.createNote!({ title: "   ", body: "", ...spaceInput });
    expect(created.title).toBe("Untitled note");
  });

  it("requires every new note to belong to a Space", async () => {
    const connector = createMistyNativeNotesConnector();
    await expect(connector.createNote!({ title: "Loose", body: "" })).rejects.toThrow(
      /belong to a Space/,
    );
  });

  it("lists Space notes from the server instead of device storage", async () => {
    spaceRequestMock.mockResolvedValueOnce({
      notes: [serverNote({ id: "note_server", title: "Server note", plain_text: "shared" })],
    });
    const connector = createMistyNativeNotesConnector(
      "account",
      spaceInput.spaceId,
      spaceInput.spaceName,
    );
    const notes = await connector.listNotes();

    expect(spaceRequestMock).toHaveBeenCalledWith("/spaces/space-product/notes");
    expect(notes.map((note) => note.title)).toEqual(["Server note"]);
    expect(notes[0].syncStatus).toBe("synced");
  });

  it("deletes native notes through their Space API route", async () => {
    spaceRequestMock
      .mockResolvedValueOnce({ notes: [serverNote({ id: "note_delete" })] })
      .mockResolvedValueOnce(undefined);
    const connector = createMistyNativeNotesConnector(
      "account",
      spaceInput.spaceId,
      spaceInput.spaceName,
    );
    await connector.listNotes();
    await connector.deleteNote!("note_delete");

    expect(spaceRequestMock).toHaveBeenLastCalledWith(
      "/spaces/space-product/notes/note_delete",
      { method: "DELETE" },
    );
  });
});

describe("NotionConnector", () => {
  it("exposes write methods now that Notion is read/write", () => {
    const connector = createNotionConnector(createFakeNotionClient().client);
    expect(connector.capabilities.read).toBe(true);
    expect(connector.capabilities.create).toBe(true);
    expect(connector.capabilities.delete).toBe(false);
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
    spaceRequestMock.mockResolvedValueOnce({
      notes: [serverNote({ id: "note_misty", title: "Misty note" })],
    });
    const notion = createNotionConnector(
      createFakeNotionClient({ pages: { "page-1": notionPage("page-1", "Roadmap") } }).client,
      { initialStatus: "connected" },
    );
    await notion.selectSources!(["page-1"]);
    const registry = new NotesConnectorRegistry([
      createMistyNativeNotesConnector("account", spaceInput.spaceId, spaceInput.spaceName),
      notion,
    ]);
    const { notes, errors } = await registry.listAllNotes();

    expect(errors).toEqual({});
    expect(notes.some((note) => note.source === "misty")).toBe(true);
    expect(notes.some((note) => note.source === "notion")).toBe(true);
  });

  it("isolates a failing connector instead of blanking the list", async () => {
    spaceRequestMock.mockResolvedValueOnce({
      notes: [serverNote({ id: "note_misty", title: "Misty note" })],
    });
    const healthy = createMistyNativeNotesConnector(
      "account",
      spaceInput.spaceId,
      spaceInput.spaceName,
    );
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

function serverNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "note_server",
    space_id: spaceInput.spaceId,
    creator_user_id: "user",
    title: "Server note",
    plain_text: "",
    lifecycle_state: "active",
    collaboration_revision: 0,
    acl_version: 1,
    role: "creator",
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}
