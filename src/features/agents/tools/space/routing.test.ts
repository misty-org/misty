import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerFor, registerLocalTools, LocalToolUncertain, type LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { HOME, SPACES, WORK, call, refusedWith, serve } from "./testRoutes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => vi.clearAllMocks());

describe("the space argument", () => {
  it("reads every Space when none is named, and says which answer is whose", async () => {
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/drawings": { drawings: [{ title: "Plan" }] },
      "GET /spaces/s0/drawings": { drawings: [] },
    });
    await expect(call(tool("drawing.list"), {})).resolves.toEqual({
      spaces: [
        { space_id: "s1", space_name: "Work", result: { drawings: [{ title: "Plan" }], count: 1 } },
        { space_id: "s0", space_name: "Home", result: { drawings: [], count: 0 } },
      ],
    });
    expect(calls.map((request) => request.path)).toContain("/spaces/s0/drawings");
  });

  it("leaves out a Space that doesn't grant the read, and keeps another Space's failure", async () => {
    serve({
      "GET /spaces": { spaces: [WORK, HOME, { ...WORK, id: "s2", name: "Other" }] },
      "GET /spaces/s1/drawings": refusedWith(403, "forbidden"),
      "GET /spaces/s0/drawings": { drawings: [] },
      "GET /spaces/s2/drawings": refusedWith(500, "internal_error"),
    });
    await expect(call(tool("drawing.list"), {})).resolves.toEqual({
      spaces: [
        { space_id: "s0", space_name: "Home", result: { drawings: [], count: 0 } },
        { space_id: "s2", space_name: "Other", error: "Misty could not complete this tool call." },
      ],
    });
  });

  it("says a read isn't allowed when no Space grants it", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/notes/n": refusedWith(404, "not_found"),
      "GET /spaces/s0/notes/n": refusedWith(404, "not_found"),
    });
    await expect(call(tool("note.read"), { id: "n" }).catch(refusal)).resolves.toBe(
      "This tool call is not allowed for the current run.",
    );
  });

  it("reads at most 25 Spaces", async () => {
    const spaces = Array.from({ length: 30 }, (_, index) => ({ ...WORK, id: `s${index}` }));
    const routes: Record<string, unknown> = { "GET /spaces": { spaces } };
    for (const { id } of spaces) routes[`GET /spaces/${id}/drawings`] = { drawings: [] };
    serve(routes);
    const answer = (await call(tool("drawing.list"), {})) as { spaces: unknown[] };
    expect(answer.spaces).toHaveLength(25);
  });

  it("finds a named Space by id or by name in any case, and answers it alone", async () => {
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

  it("names the choices when the Space is unknown or ambiguous", async () => {
    serve(SPACES);
    await expect(call(tool("drawing.list"), { space: "Nope" }).catch(refusal)).resolves.toBe(
      'unknown space "Nope"; available: "Work" (s1), "Home" (s0)',
    );
    serve({ "GET /spaces": { spaces: [WORK, { ...WORK, id: "s9" }] } });
    await expect(call(tool("drawing.list"), { space: "Work" }).catch(refusal)).resolves.toBe(
      'several Spaces are named "Work"; pass one id: "Work" (s1), "Work" (s9)',
    );
  });

  it("creates in the personal Space by default", async () => {
    const calls = serve({ ...SPACES, "POST /spaces/s0/drawings": { id: "d" } });
    await call(tool("drawing.create"), { title: "New" });
    expect(calls[1]).toMatchObject({ path: "/spaces/s0/drawings", body: { title: "New" } });
  });

  it("makes a change to an existing item name its Space", async () => {
    serve(SPACES);
    await expect(
      call(tool("note.update"), { id: "n", markdown: "x" }).catch(refusal),
    ).resolves.toBe('pass space for this change; available: "Work" (s1), "Home" (s0)');
  });

  it("reports an account with no Spaces", async () => {
    serve({ "GET /spaces": { spaces: [] } });
    await expect(call(tool("drawing.list"), {}).catch(refusal)).resolves.toBe(
      "this account has no Spaces yet",
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
