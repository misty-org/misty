import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerFor, registerLocalTools, LocalToolUncertain, type LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { runSpaceId } from "../runContexts";
import { SPACES, call, refusedWith, serve } from "./testRoutes";

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

describe("the space argument", () => {
  it("works in the run's home Space when none is named", async () => {
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/drawings": { drawings: [{ title: "Plan" }] },
    });
    await expect(call(tool("drawing.list"), {})).resolves.toEqual({
      drawings: [{ title: "Plan" }],
      count: 1,
    });
    expect(calls.map((request) => request.path)).not.toContain("/spaces/s0/drawings");
  });

  it("finds the home Space by id or by name in any case", async () => {
    serve({ ...SPACES, "GET /spaces/s1/drawings": { drawings: [] } });
    await expect(call(tool("drawing.list"), { space: "s1" })).resolves.toEqual({
      drawings: [],
      count: 0,
    });
    await expect(call(tool("drawing.list"), { space: " work " })).resolves.toEqual({
      drawings: [],
      count: 0,
    });
  });

  it("refuses any other Space, by id or by name", async () => {
    const calls = serve(SPACES);
    for (const space of ["s0", "Home", "Nope"]) {
      await expect(call(tool("drawing.list"), { space }).catch(refusal)).resolves.toBe(
        "I can only work in Work. Ask an agent in that Space.",
      );
    }
    expect(calls.every((request) => request.path === "/spaces")).toBe(true);
  });

  it("creates in the home Space without naming it", async () => {
    const calls = serve({ ...SPACES, "POST /spaces/s1/drawings": { id: "d" } });
    await call(tool("drawing.create"), { title: "New" });
    expect(calls[1]).toMatchObject({ path: "/spaces/s1/drawings", body: { title: "New" } });
  });

  it("works in the person's own Space for an agent with no home Space yet", async () => {
    vi.mocked(runSpaceId).mockResolvedValueOnce("");
    const calls = serve({ ...SPACES, "POST /spaces/s0/drawings": { id: "d" } });
    await call(tool("drawing.create"), { title: "New" });
    expect(calls[1]).toMatchObject({ path: "/spaces/s0/drawings" });
  });

  it("asks for a new home Space once the run's is gone", async () => {
    vi.mocked(runSpaceId).mockResolvedValueOnce("gone");
    serve(SPACES);
    await expect(call(tool("drawing.list"), {}).catch(refusal)).resolves.toBe(
      "My home Space is gone: it was deleted, or the person left it. Ask them to pick a new home Space in my settings.",
    );
  });

  it("reaches no Space for a run nobody noted", async () => {
    vi.mocked(runSpaceId).mockResolvedValueOnce(null);
    serve(SPACES);
    await expect(call(tool("drawing.list"), {}).catch(refusal)).resolves.toBe(
      "This tool call is not allowed for the current run.",
    );
  });
});

describe("what a failed call tells the run", () => {
  const ask = (name: string, input: unknown) =>
    answerFor({ run_id: "r", call_id: "c", name, input }, new AbortController().signal);

  beforeEach(() => registerLocalTools(spaceTools));

  it("lets the model correct what the server refused", async () => {
    serve({ ...SPACES, "PUT /spaces/s1/notes/n/content": refusedWith(400, "invalid_request") });
    await expect(ask("note.update", { space: "s1", id: "n" })).resolves.toEqual({
      state: "failed",
      code: "invalid_request",
      message: "The tool arguments are invalid.",
    });
  });

  it.each([
    [403, "forbidden", "This tool call is not allowed for the current run."],
    [404, "not_found", "Misty could not complete this tool call."],
    [409, "version_conflict", "Misty could not complete this tool call."],
    [429, "rate_limited", "server words"],
    [403, "account_closing", "server words"],
    [401, "not_authenticated", "server words"],
    [
      409,
      "drawing_conflict",
      "The drawing changed since it was read. Call drawing_read again, then retry with its latest base_hash.",
    ],
    [
      413,
      "document_too_large",
      "The drawing would exceed the collaboration document size limit. Apply a smaller scene or delete unused elements first.",
    ],
  ])("maps a %i %s", async (status, code, message) => {
    serve({ ...SPACES, "POST /spaces/s1/drawings/d/scene": refusedWith(status, code) });
    await expect(ask("drawing.apply", { space: "s1", drawing_id: "d" })).resolves.toEqual({
      state: "failed",
      code,
      message,
    });
  });

  it("treats a write with no clear answer as uncertain", async () => {
    for (const failure of [
      refusedWith(500, "internal_error"),
      refusedWith(504),
      new Error("Load failed"),
    ]) {
      serve({
        ...SPACES,
        "POST /spaces/s1/messages": failure,
        "GET /spaces/s1/members": { members: [] },
        "GET /me": { id: "me" },
      });
      await expect(
        ask("message.send", { space: "s1", message: "hi", audience: "space" }),
      ).resolves.toEqual({
        state: "uncertain",
        message: "The action may have completed. Reconcile its outcome before retrying.",
      });
    }
    await expect(
      call(tool("message.send"), { space: "s1", message: "hi", audience: "space" }),
    ).rejects.toBeInstanceOf(LocalToolUncertain);
  });

  it("knows a read with no answer changed nothing", async () => {
    serve({ ...SPACES, "GET /spaces/s1/notes/n": new Error("Load failed") });
    await expect(ask("note.read", { space: "s1", id: "n" })).resolves.toEqual({
      state: "failed",
      code: "request_failed",
      message: "Misty could not complete this tool call.",
    });
  });

  it("knows a change refused because of a failed read before it changed nothing", async () => {
    serve({ ...SPACES, "GET /spaces/s1/library/items/i": refusedWith(502) });
    await expect(ask("file.update", { space: "s1", id: "i" })).resolves.toMatchObject({
      state: "failed",
    });
  });

  it("refuses arguments the schema doesn't allow before reaching a route", async () => {
    const calls = serve(SPACES);
    await expect(ask("note.search", { space: "s1", limit: 51 })).resolves.toEqual({
      state: "failed",
      code: "invalid_request",
      message: "The arguments do not match this tool's input schema.",
    });
    expect(calls.map((request) => request.path)).toEqual(["/spaces"]);
  });
});

describe("the tool list", () => {
  it("has every Space tool and none of the removed agent requests", () => {
    expect(Object.keys(spaceTools).sort()).toEqual([
      "drawing.apply",
      "drawing.create",
      "drawing.list",
      "drawing.read",
      "file.promote_attachment",
      "file.read",
      "file.search",
      "file.update",
      "item.delete",
      "item.rename",
      "message.search",
      "message.send",
      "note.create",
      "note.read",
      "note.search",
      "note.tag",
      "note.update",
      "search.all",
      "space.list",
      "space.manage",
      "space.member.list",
      "space.member.resolve",
      "thread.create",
      "thread.list",
      "thread.post",
      "thread.read",
    ]);
  });
});
