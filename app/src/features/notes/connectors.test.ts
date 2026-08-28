import { beforeEach, describe, expect, it, vi } from "vitest";

const spaceRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/platform/openExternalLink", () => ({
  openExternalLink: vi.fn(async () => {}),
}));

vi.mock("@/api/spaces/api", () => ({
  spaceRequest: spaceRequestMock,
}));

import { createMistyNativeNotesConnector } from "./connectors/mistyNativeNotes";
import { createDefaultNotesRegistry, NotesConnectorRegistry } from "./connectors/registry";

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

    expect(spaceRequestMock).toHaveBeenLastCalledWith("/spaces/space-product/notes/note_delete", {
      method: "DELETE",
    });
  });
});

describe("NotesConnectorRegistry", () => {
  it("registers native Misty notes by default", () => {
    const registry = createDefaultNotesRegistry("account-1");
    expect(registry.forSource("misty")?.providerId).toBe("misty");
    expect(registry.list().map((connector) => connector.providerId)).toEqual(["misty"]);
  });

  it("resolves connectors by source", () => {
    const registry = new NotesConnectorRegistry([createMistyNativeNotesConnector()]);
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
