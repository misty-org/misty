import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkNotesApi, createSdkNotesStore } from "./noteServices";
import { createMistyNotesConnector } from "./connectors/mistyNotesConnector";

const note = {
  id: "note-a",
  space_id: "space-a",
  creator_user_id: "user-a",
  title: "SDK note",
  lifecycle_state: "active",
  collaboration_revision: 0,
  acl_version: 1,
  audience_kind: "space",
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
  role: "creator",
  can_delete: true,
  backlink_count: 0,
};
it("uses the public SDK contracts for the existing Notes connector, normalizing empty server lists", async () => {
  const request = vi.fn(async (message: { method: string; params?: unknown }) => {
    if (message.method === "notes.list") return { notes: [note] };
    if (message.method === "notes.backlinks") return { backlinks: null };
    if (message.method === "notes.create") return note;
    return undefined;
  });
  const api = createSdkNotesApi(createMistyAppSDK({ request }), "space-a");
  const connector = createMistyNotesConnector(api, "account-a", "space-a", "Product");
  const notes = await connector.listNotes();
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ sourceId: "note-a", title: "SDK note", spaceId: "space-a" });
  await connector.createNote!({
    title: "SDK note",
    body: "",
    spaceId: "space-a",
    spaceName: "Product",
  });
  expect(request).toHaveBeenCalledWith({
    method: "notes.create",
    params: { body: { title: "SDK note" } },
  });
  expect(await api.backlinks("space-a", "note-a")).toEqual({ backlinks: [] });
  await api.archive("space-a", "note-a");
  expect(request).toHaveBeenCalledWith({
    method: "notes.archive",
    params: { path: { noteID: "note-a" }, body: { archived: true } },
  });
  const count = request.mock.calls.length;
  await expect(api.list("space-b")).rejects.toThrow("different Space");
  expect(request).toHaveBeenCalledTimes(count);
});

it("keeps two Journal views independent and ignores an old archive after a reset", async () => {
  let archived!: () => void;
  const requestA = vi.fn(async (message: { method: string }) => {
    if (message.method === "notes.list") return { notes: [note] };
    if (message.method === "notes.archive")
      return new Promise<void>((resolve) => {
        archived = resolve;
      });
    return undefined;
  });
  const a = createSdkNotesStore(createMistyAppSDK({ request: requestA }), "space-a", vi.fn());
  const b = createSdkNotesStore(
    createMistyAppSDK({
      request: async (message) =>
        message.method === "notes.list"
          ? { notes: [{ ...note, space_id: "space-b", title: "Second Space" }] }
          : undefined,
    }),
    "space-b",
    vi.fn(),
  );
  await Promise.all([
    a.useStore.getState().load("account-a", "space-a", "First"),
    b.useStore.getState().load("account-a", "space-b", "Second"),
  ]);
  a.useStore.getState().setQuery("mine");
  expect(b.useStore.getState().query).toBe("");
  expect(b.useStore.getState().notes[0].title).toBe("Second Space");
  const pending = a.useStore.getState().archiveNote(a.useStore.getState().notes[0].id);
  a.reset();
  await a.useStore.getState().load("account-a", "space-a", "First");
  archived();
  await pending;
  expect(a.useStore.getState().notes).toHaveLength(1);
  expect(b.useStore.getState().notes).toHaveLength(1);
  a.reset();
  b.reset();
});

it("does not attach a late creation failure to a new Journal list", async () => {
  let rejectCreate!: (error: Error) => void;
  const sdk = createMistyAppSDK({
    request: async (message) => {
      if (message.method === "notes.list") return { notes: [note] };
      if (message.method === "notes.create")
        return new Promise((_, reject) => {
          rejectCreate = reject;
        });
      return undefined;
    },
  });
  const a = createSdkNotesStore(sdk, "space-a", vi.fn());
  await a.useStore.getState().load("account-a", "space-a", "First");
  const pending = a.useStore.getState().createNote({ title: "old", body: "" });
  a.reset();
  await a.useStore.getState().load("account-a", "space-a", "First");
  rejectCreate(new Error("old failure"));
  await pending;
  expect(a.useStore.getState().connectorErrors).toEqual({});
  a.reset();
});
