import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Space } from "@/api/spaces/dto/entities";
const api = vi.hoisted(() => ({
  notes: vi.fn(),
  drawings: vi.fn(),
  libraryItems: vi.fn(),
  conversations: vi.fn(),
  removeNote: vi.fn(),
  renameDrawing: vi.fn(),
  removeDrawing: vi.fn(),
  updateLibraryItem: vi.fn(),
  trashLibraryItem: vi.fn(),
  updateConversation: vi.fn(),
  deleteOrClearConversation: vi.fn(),
}));
vi.mock("@/api/notes/api", () => ({ notesApi: { list: api.notes, remove: api.removeNote } }));
vi.mock("@/api/drawings/api", () => ({
  drawingsApi: { list: api.drawings, rename: api.renameDrawing, remove: api.removeDrawing },
}));
vi.mock("@/api/spaces/api", () => ({ spacesApi: api }));
import { useSpaceOverview } from "./useSpaceOverview";
const space = { id: "personal", name: "Personal" } as Space;
beforeEach(() => {
  vi.clearAllMocks();
  api.notes.mockReset().mockResolvedValue({
    notes: [
      { id: "n", title: "Note", lifecycle_state: "active", updated_at: "2026-09-30T12:00:00Z" },
    ],
  });
  api.drawings.mockReset().mockResolvedValue({ drawings: [] });
  api.libraryItems.mockReset().mockResolvedValue({ items: [] });
  api.conversations.mockReset().mockResolvedValue({ conversations: [] });
});
afterEach(cleanup);

it("uses versioned operations and preserves conversation participants when renaming", async () => {
  const file = { id: "f", display_name: "File", version: 3, favorite: false };
  const conversation = {
    id: "c",
    created_by_user_id: "owner",
    participants: [{ user_id: "owner" }, { user_id: "sam" }],
  };
  api.notes.mockResolvedValue({
    notes: [{ id: "n", role: "creator", can_delete: true, lifecycle_state: "active" }],
  });
  api.drawings.mockResolvedValue({
    drawings: [{ id: "d", role: "editor", can_delete: false, lifecycle_state: "active" }],
  });
  api.libraryItems.mockResolvedValue({ items: [file] });
  api.conversations.mockResolvedValue({ conversations: [conversation] });
  const { result } = renderHook(() => useSpaceOverview("owner", { ...space, role: "owner" }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const byKind = (kind: string) => result.current.items.find((item) => item.kind === kind)!;
  await byKind("note").remove!();
  expect(api.removeNote).toHaveBeenCalledWith("personal", "n");
  expect(byKind("note").renameRoute).toContain("rename=1");
  await byKind("drawing").rename!("Sketch");
  expect(api.renameDrawing).toHaveBeenCalledWith("personal", "d", "Sketch");
  expect(byKind("drawing").remove).toBeUndefined();
  await byKind("file").rename!("New file");
  await byKind("file").remove!();
  expect(api.updateLibraryItem).toHaveBeenCalledWith("personal", file, {
    display_name: "New file",
  });
  expect(api.updateLibraryItem).not.toHaveBeenCalledWith("personal", file, { favorite: true });
  expect(api.trashLibraryItem).toHaveBeenCalledWith("personal", "f");
  await byKind("chat").rename!("Chat");
  expect(api.updateConversation).toHaveBeenCalledWith("personal", "c", "Chat", [
    { kind: "person", user_id: "owner" },
    { kind: "person", user_id: "sam" },
  ]);
});

it("lets every member manage files but keeps note, drawing and chat roles", async () => {
  api.notes.mockResolvedValue({
    notes: [{ id: "n", role: "viewer", can_delete: false, lifecycle_state: "active" }],
  });
  api.drawings.mockResolvedValue({
    drawings: [{ id: "d", role: "viewer", can_delete: false, lifecycle_state: "active" }],
  });
  api.libraryItems.mockResolvedValue({ items: [{ id: "f" }] });
  api.conversations.mockResolvedValue({
    conversations: [{ id: "c", created_by_user_id: "someone-else" }],
  });
  const restricted = {
    ...space,
    role: "member",
  } as Space;
  const { result } = renderHook(() => useSpaceOverview("viewer", restricted));
  await waitFor(() => expect(result.current.loading).toBe(false));
  for (const item of result.current.items) {
    if (item.kind === "file") {
      expect(item.rename).toBeDefined();
      expect(item.remove).toBeDefined();
      continue;
    }
    expect(item.rename).toBeUndefined();
    expect(item.renameRoute).toBeUndefined();
    expect(item.remove).toBeUndefined();
  }
});

it("preserves each source's creator and attributes Library additions to the person who added them", async () => {
  api.notes.mockResolvedValue({
    notes: [{ id: "n", lifecycle_state: "active", creator_user_id: "note-author" }],
  });
  api.drawings.mockResolvedValue({
    drawings: [{ id: "d", lifecycle_state: "active", creator_user_id: "drawing-author" }],
  });
  api.conversations.mockResolvedValue({
    conversations: [{ id: "c", created_by_user_id: "chat-author" }],
  });
  api.libraryItems.mockResolvedValue({
    items: [
      {
        id: "f",
        added_by_user_id: "added-by",
        contributing_user_id: "contributor",
        file: { uploader_user_id: "uploader" },
      },
    ],
  });
  const { result } = renderHook(() => useSpaceOverview("owner", space));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(
    result.current.items
      .filter((item) => item.id !== "chat:everyone")
      .map(({ kind, creatorUserId, creatorAgentId }) => ({
        kind,
        creatorUserId,
        creatorAgentId,
      })),
  ).toEqual([
    { kind: "note", creatorUserId: "note-author", creatorAgentId: undefined },
    { kind: "drawing", creatorUserId: "drawing-author", creatorAgentId: undefined },
    { kind: "chat", creatorUserId: "chat-author", creatorAgentId: undefined },
    { kind: "file", creatorUserId: "added-by", creatorAgentId: undefined },
  ]);
});

it("keeps successful sources available when another fails and retries", async () => {
  api.conversations.mockRejectedValueOnce(new Error("offline"));
  const { result } = renderHook(() => useSpaceOverview("owner", space));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(
    result.current.items.filter((item) => item.id !== "chat:everyone").map((i) => i.title),
  ).toEqual(["Note"]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.failed).toBe(false));
});

it("hides old results immediately on account changes and ignores late responses", async () => {
  let resolveOld!: (value: unknown) => void;
  api.notes.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const { result, rerender } = renderHook(({ account }) => useSpaceOverview(account, space), {
    initialProps: { account: "old" },
  });
  rerender({ account: "new" });
  expect(result.current.items).toEqual([]);
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () =>
    resolveOld({ notes: [{ id: "secret", title: "Previous account", lifecycle_state: "active" }] }),
  );
  expect(
    result.current.items.filter((item) => item.id !== "chat:everyone").map((i) => i.title),
  ).toEqual(["Note"]);
});

it("excludes hidden files, trashed files and inactive journal entries", async () => {
  api.libraryItems.mockResolvedValue({
    items: [
      { id: "hidden", hidden: true },
      { id: "trash", trashed_at: "today" },
      { id: "file", display_name: "Visible", updated_at: "2026-09-30T13:00:00Z" },
    ],
  });
  api.drawings.mockResolvedValue({ drawings: [{ id: "deleting", lifecycle_state: "deleting" }] });
  const { result } = renderHook(() => useSpaceOverview("owner", space));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(
    result.current.items.filter((item) => item.id !== "chat:everyone").map((i) => i.title),
  ).toEqual(["Visible", "Note"]);
});

it("loads both Journal types without unrelated tools when opened on its own", async () => {
  api.drawings.mockResolvedValue({
    drawings: [
      { id: "n", title: "Sketch", lifecycle_state: "active", updated_at: "2026-10-01T12:00:00Z" },
    ],
  });
  const { result } = renderHook(() => useSpaceOverview("owner", space, "Journal"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items.map((item) => item.id)).toEqual(["drawing:n", "note:n"]);
  expect(api.libraryItems).not.toHaveBeenCalled();
  expect(api.conversations).not.toHaveBeenCalled();
});
