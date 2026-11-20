import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { SPACES, call, serve } from "./testRoutes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));
// The run works in its agent's home Space, Work.
vi.mock("../runContexts", async (original) => ({
  ...(await original<object>()),
  runSpaceId: vi.fn(async () => "s1"),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => vi.clearAllMocks());

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
