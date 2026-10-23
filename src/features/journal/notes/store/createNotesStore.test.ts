import { describe, expect, it, vi } from "vitest";
import type { ServerSpaceNote } from "@/api/notes/api";
import { createNotesStore } from "./createNotesStore";

function serverNote(overrides: Partial<ServerSpaceNote> = {}): ServerSpaceNote {
  return {
    id: "note_server",
    space_id: "space-product",
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

function setup() {
  const api = {
    list: vi.fn(async () => ({
      notes: [serverNote({ title: "Server note", plain_text: "shared" })],
    })),
    create: vi.fn(async (_spaceId: string, title: string) => serverNote({ id: "created", title })),
    remove: vi.fn(async () => undefined),
  };
  const closeCollaboration = vi.fn();
  const { useStore } = createNotesStore({ api, closeCollaboration });
  return { api, closeCollaboration, store: useStore };
}

describe("notes store", () => {
  it("lists the Space's notes from the server", async () => {
    const { api, store } = setup();
    await store.getState().load("account", "space-product", "Product");
    expect(api.list).toHaveBeenCalledWith("space-product");
    const [note] = store.getState().notes;
    expect(note).toMatchObject({ title: "Server note", preview: "shared", syncStatus: "synced" });
    expect(store.getState().selectedNoteId).toBe(note.id);
  });

  it("creates notes in the open Space with a placeholder title", async () => {
    const { api, store } = setup();
    await store.getState().load("account", "space-product", "Product");
    const created = await store.getState().createNote({ title: "   ", body: "" });
    expect(api.create).toHaveBeenCalledWith("space-product", "Untitled note");
    expect(created?.spaceId).toBe("space-product");
    expect(store.getState().selectedNoteId).toBe(created?.id);
  });

  it("requires a Space before creating a note", async () => {
    const { api, store } = setup();
    expect(await store.getState().createNote({ title: "Loose", body: "" })).toBeUndefined();
    expect(api.create).not.toHaveBeenCalled();
    expect(store.getState().error).toMatch(/Open a Space/);
  });

  it("deletes notes through their Space and closes open collaboration", async () => {
    const { api, closeCollaboration, store } = setup();
    await store.getState().load("account", "space-product", "Product");
    await store.getState().deleteNote(store.getState().notes[0].id);
    expect(api.remove).toHaveBeenCalledWith("space-product", "note_server");
    expect(closeCollaboration).toHaveBeenCalled();
    expect(store.getState().notes).toEqual([]);
  });
});
