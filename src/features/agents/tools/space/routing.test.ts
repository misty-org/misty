import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerFor, registerLocalTools, LocalToolUncertain, type LocalToolRejected } from "../host";
import { spaceTools } from "../space_tools";
import { runSpaceId } from "../run_contexts";
import { SPACES, call, refusedWith, serve } from "./test_routes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));
vi.mock("../run_contexts", async (original) => ({
  ...(await original<object>()),
  runSpaceId: vi.fn(async () => "s1"),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => vi.clearAllMocks());

const THREADS = "/spaces/s1/conversations";

describe("the space argument", () => {
  it("works in the run's home Space when none is named", async () => {
    const calls = serve({
      ...SPACES,
      [`GET ${THREADS}`]: { conversations: [{ id: "t", title: "Plan" }] },
    });
    await expect(call(tool("thread.list"), {})).resolves.toMatchObject({
      threads: [{ id: "t", title: "Plan" }],
    });
    expect(calls.map((request) => request.path)).not.toContain("/spaces/s0/conversations");
  });

  it("finds the home Space by id or by name in any case", async () => {
    serve({ ...SPACES, [`GET ${THREADS}`]: { conversations: [] } });
    await expect(call(tool("thread.list"), { space: "s1" })).resolves.toEqual({ threads: [] });
    await expect(call(tool("thread.list"), { space: " work " })).resolves.toEqual({
      threads: [],
    });
  });

  it("refuses any other Space, by id or by name", async () => {
    const calls = serve(SPACES);
    for (const space of ["s0", "Home", "Nope"]) {
      await expect(call(tool("thread.list"), { space }).catch(refusal)).resolves.toBe(
        "I can only work in Work. Ask an agent in that Space.",
      );
    }
    expect(calls.every((request) => request.path === "/spaces")).toBe(true);
  });

  it("creates in the home Space without naming it", async () => {
    const calls = serve({
      ...SPACES,
      "POST /spaces/s1/conversations": { id: "t", title: "New" },
    });
    await call(tool("thread.create"), { title: "New", member_ids: ["u1"] });
    expect(calls[1]).toMatchObject({
      path: "/spaces/s1/conversations",
      body: { title: "New", participants: [{ kind: "person", user_id: "u1" }] },
    });
  });

  it("works in the person's own Space for an agent with no home Space yet", async () => {
    vi.mocked(runSpaceId).mockResolvedValueOnce("");
    const calls = serve({
      ...SPACES,
      "POST /spaces/s0/conversations": { id: "t", title: "New" },
    });
    await call(tool("thread.create"), { title: "New", member_ids: ["u1"] });
    expect(calls[1]).toMatchObject({ path: "/spaces/s0/conversations" });
  });

  it("asks for a new home Space once the run's is gone", async () => {
    vi.mocked(runSpaceId).mockResolvedValueOnce("gone");
    serve(SPACES);
    await expect(call(tool("thread.list"), {}).catch(refusal)).resolves.toBe(
      "My home Space is gone: it was deleted, or the person left it. Ask them to pick a new home Space in my settings.",
    );
  });

  it("reaches no Space for a run nobody noted", async () => {
    vi.mocked(runSpaceId).mockResolvedValueOnce(null);
    serve(SPACES);
    await expect(call(tool("thread.list"), {}).catch(refusal)).resolves.toBe(
      "This tool call is not allowed for the current run.",
    );
  });
});

describe("what a failed call tells the run", () => {
  const ask = (name: string, input: unknown) =>
    answerFor({ run_id: "r", call_id: "c", name, input }, new AbortController().signal);

  beforeEach(() => registerLocalTools(spaceTools));

  it("lets the model correct what the server refused", async () => {
    serve({ ...SPACES, [`GET ${THREADS}`]: refusedWith(400, "invalid_request") });
    await expect(ask("thread.list", { space: "s1" })).resolves.toEqual({
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
  ])("maps a %i %s", async (status, code, message) => {
    serve({ ...SPACES, [`GET ${THREADS}`]: refusedWith(status, code) });
    await expect(ask("thread.list", { space: "s1" })).resolves.toEqual({
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
    serve({ ...SPACES, [`GET ${THREADS}`]: new Error("Load failed") });
    await expect(ask("thread.list", { space: "s1" })).resolves.toEqual({
      state: "failed",
      code: "request_failed",
      message: "Misty could not complete this tool call.",
    });
  });

  it("knows a change refused because of a failed read before it changed nothing", async () => {
    serve({ ...SPACES, [`GET ${THREADS}`]: refusedWith(502) });
    await expect(
      ask("item.rename", { space: "s1", kind: "thread", id: "t", name: "x" }),
    ).resolves.toMatchObject({
      state: "failed",
    });
  });

  it("refuses arguments the schema doesn't allow before reaching a route", async () => {
    const calls = serve(SPACES);
    await expect(ask("thread.read", { space: "s1", thread_id: "t", limit: 31 })).resolves.toEqual({
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
      "file.create",
      "file.promote_attachment",
      "file.read",
      "file.search",
      "file.update",
      "file.upload",
      "item.delete",
      "item.rename",
      "media.fetch",
      "message.search",
      "message.send",
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
