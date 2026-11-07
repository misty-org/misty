import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { SPACES, call, refusedWith, serve } from "./testRoutes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => vi.clearAllMocks());

describe("notes", () => {
  it("searches with the server's full-text search, and encodes the words", async () => {
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/notes?q=q3%20budget%26x&limit=5": { notes: [{ id: "n" }] },
    });
    await expect(
      call(tool("note.search"), { space: "s1", query: " q3 budget&x ", limit: 5 }),
    ).resolves.toEqual({
      notes: [{ id: "n" }],
      count: 1,
    });
    expect(calls).toHaveLength(2);
  });

  it("lists the newest with no words, up to the limit", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/notes": { notes: Array.from({ length: 30 }, (_, id) => ({ id })) },
    });
    const answer = (await call(tool("note.search"), { space: "s1" })) as { count: number };
    expect(answer.count).toBe(20);
  });

  it("reads a note with its body always present", async () => {
    const note = {
      id: "n",
      space_id: "s1",
      title: "T",
      created_at: "c",
      updated_at: "u",
      role: "editor",
      collaboration_revision: 4,
    };
    serve({ ...SPACES, "GET /spaces/s1/notes/n": note });
    await expect(call(tool("note.read"), { space: "s1", id: "n" })).resolves.toEqual({
      id: "n",
      space_id: "s1",
      title: "T",
      markdown: "",
      empty: true,
      created_at: "c",
      updated_at: "u",
      role: "editor",
    });
    await expect(call(tool("note.read"), { space: "s1" }).catch(refusal)).resolves.toBe(
      "note id is required",
    );
  });

  it("creates with a body, and needs both", async () => {
    const receipt = { id: "n", content_receipt: { operation: "create" } };
    const calls = serve({ ...SPACES, "POST /spaces/s0/notes": receipt });
    await expect(call(tool("note.create"), { title: "T", markdown: "# Hi" })).resolves.toEqual(
      receipt,
    );
    expect(calls[1].body).toEqual({ title: "T", markdown: "# Hi" });
    await expect(
      call(tool("note.create"), { title: "T", markdown: " " }).catch(refusal),
    ).resolves.toBe("note title and markdown are required");
  });

  it("updates through the content route, and refuses replacing and adding at once", async () => {
    const calls = serve({ ...SPACES, "PUT /spaces/s1/notes/n/content": { id: "n" } });
    await call(tool("note.update"), { space: "s1", id: "n", append: "More" });
    expect(calls[1].body).toEqual({ title: "", markdown: "", append: "More" });
    await expect(
      call(tool("note.update"), { space: "s1", id: "n", markdown: "a", append: "b" }).catch(
        refusal,
      ),
    ).resolves.toBe("use markdown to replace the body or append to add to it, not both");
  });

  it("tags a note it finds in that Space", async () => {
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/notes/n": { id: "n" },
      "PATCH /spaces/s1/notes/n/metadata": { id: "n" },
    });
    await expect(call(tool("note.tag"), { space: "s1", id: "n", tags: ["a"] })).resolves.toEqual({
      note_id: "n",
      tags: ["a"],
    });
    expect(calls[2].body).toEqual({ shared_tags: ["a"] });
  });

  it("words a tag refusal so the model can act on it", async () => {
    serve({ ...SPACES, "GET /spaces/s1/notes/n": refusedWith(404, "not_found") });
    await expect(
      call(tool("note.tag"), { space: "s1", id: "n", tags: [] }).catch(refusal),
    ).resolves.toBe("no note n in this Space; call note_search");
    serve({
      ...SPACES,
      "GET /spaces/s1/notes/n": { id: "n" },
      "PATCH /spaces/s1/notes/n/metadata": refusedWith(403, "forbidden"),
    });
    await expect(
      call(tool("note.tag"), { space: "s1", id: "n", tags: [] }).catch(refusal),
    ).resolves.toBe("those tags could not be saved; you may not be able to edit this note");
  });
});

describe("drawings", () => {
  it("filters the list by title and limit", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/drawings": {
        drawings: [{ title: "Floor plan" }, { title: "Plan B" }, { title: "Map" }],
      },
    });
    await expect(
      call(tool("drawing.list"), { space: "s1", query: "PLAN", limit: 1 }),
    ).resolves.toEqual({
      drawings: [{ title: "Floor plan" }],
      count: 1,
    });
  });

  it("reads the live scene", async () => {
    const scene = { ok: true, revision: 2, elements: [], drawing: { id: "d" } };
    serve({ ...SPACES, "GET /spaces/s1/drawings/d/scene?include_deleted=true": scene });
    await expect(
      call(tool("drawing.read"), { space: "s1", drawing_id: "d", include_deleted: true }),
    ).resolves.toEqual(scene);
    await expect(call(tool("drawing.read"), { space: "s1" }).catch(refusal)).resolves.toBe(
      "drawing_id is required",
    );
  });

  it("applies a change with the call as its idempotency key, without the routing fields", async () => {
    const calls = serve({ ...SPACES, "POST /spaces/s1/drawings/d/scene": { ok: true } });
    const elements = [{ id: "a", type: "text", text: "Hi" }];
    await call(tool("drawing.apply"), { space: "s1", drawing_id: "d", mode: "merge", elements });
    expect(calls[1]).toMatchObject({
      body: { mode: "merge", elements },
      headers: { "Idempotency-Key": "call-1" },
    });
  });

  it("holds a change to its schema", async () => {
    const bad = "The arguments do not match this tool's input schema.";
    serve(SPACES);
    for (const input of [
      { mode: "swap" },
      { base_hash: "short" },
      { elements: [{ type: "text" }] },
      { elements: [{ id: "a", type: "blob" }] },
      { delete_element_ids: [""] },
      { scene: [] },
    ]) {
      await expect(
        call(tool("drawing.apply"), { space: "s1", drawing_id: "d", ...input }).catch(refusal),
      ).resolves.toBe(bad);
    }
  });
});

describe("files", () => {
  it("searches what's visible in the Library", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/library?limit=20&visibility=visible&q=tax%20form": {
        items: [{ id: "i" }],
        next_after: "",
      },
    });
    await expect(
      call(tool("file.search"), { space: "s1", query: "tax form", limit: 99 }),
    ).resolves.toEqual({
      items: [{ id: "i" }],
      count: 1,
    });
  });

  it("reads an item", async () => {
    serve({ ...SPACES, "GET /spaces/s1/library/items/i": { id: "i" } });
    await expect(call(tool("file.read"), { space: "s1", id: "i" })).resolves.toEqual({ id: "i" });
    await expect(call(tool("file.read"), { space: "s1", id: " " }).catch(refusal)).resolves.toBe(
      "Library item id is required",
    );
  });

  it("merges an update over the current item at its version", async () => {
    const current = {
      id: "i",
      version: 7,
      display_name: "a.png",
      caption: "old",
      tags: ["x"],
      favorite: true,
      hidden: false,
    };
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/library/items/i": current,
      "PATCH /spaces/s1/library/items/i": { id: "i" },
    });
    await call(tool("file.update"), { space: "s1", id: "i", caption: "", hidden: true });
    expect(calls[2].body).toEqual({
      version: 7,
      display_name: "a.png",
      caption: "",
      tags: ["x"],
      favorite: true,
      hidden: true,
    });
  });

  it("promotes an attachment", async () => {
    serve({ ...SPACES, "POST /spaces/s1/attachments/a/promote": { id: "i" } });
    await expect(
      call(tool("file.promote_attachment"), { space: "s1", attachmentId: "a" }),
    ).resolves.toEqual({ id: "i" });
    await expect(
      call(tool("file.promote_attachment"), { space: "s1" }).catch(refusal),
    ).resolves.toBe("attachment id is required");
  });
});
