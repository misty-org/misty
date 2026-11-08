import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { wholeSeconds } from "./threads";
import { messageSpans } from "./messages";
import { SPACES, call, refusedWith, serve } from "./testRoutes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;
const bob = { user_id: "u2", name: "Bob Lee", email: "bob@x.test", role: "member" };
const me = { user_id: "u1", name: "Ada", email: "ada@x.test", role: "owner" };
const people = { "GET /spaces/s1/members": { members: [me, bob] }, "GET /me": { id: "u1" } };

beforeEach(() => vi.clearAllMocks());

describe("messages", () => {
  it("searches with full-text search, and lists recent chat with no words", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/messages/search?q=launch&limit=20": { messages: [{ id: "m" }], count: 1 },
    });
    await expect(call(tool("message.search"), { space: "s1", query: "launch" })).resolves.toEqual({
      messages: [{ id: "m" }],
      count: 1,
    });
    serve({
      ...SPACES,
      "GET /spaces/s1/messages?limit=100": { messages: [{ id: "a" }, { id: "b" }] },
    });
    await expect(call(tool("message.search"), { space: "s1", limit: 1 })).resolves.toEqual({
      messages: [{ id: "a" }],
      count: 1,
    });
  });

  it("sends to the Space as plain text", async () => {
    const calls = serve({
      ...SPACES,
      ...people,
      "POST /spaces/s1/messages": { message: { id: "m" } },
    });
    await expect(
      call(tool("message.send"), { space: "s1", message: " Hello ", audience: "space" }),
    ).resolves.toEqual({
      message_id: "m",
      space_id: "s1",
      conversation_id: "",
      audience: "space",
    });
    expect(calls[calls.length - 1].body).toEqual({ content: [{ type: "text", text: "Hello" }] });
  });

  it("sends privately through the person's DM, with @names as mentions", async () => {
    const calls = serve({
      ...SPACES,
      ...people,
      "POST /spaces/s1/conversations/dm": { id: "dm" },
      "POST /spaces/s1/conversations/dm/messages": { message: { id: "m" } },
    });
    await expect(
      call(tool("message.send"), { space: "s1", message: "Hi @Bob Lee!", recipientUserId: "u2" }),
    ).resolves.toEqual({
      message_id: "m",
      space_id: "s1",
      conversation_id: "dm",
      audience: "private",
    });
    expect(calls.find((request) => request.path.endsWith("/dm"))?.body).toEqual({ user_id: "u2" });
    expect(calls[calls.length - 1].body).toEqual({
      content: [
        { type: "text", text: "Hi " },
        { type: "mention", user_id: "u2", label: "Bob Lee" },
        { type: "text", text: "!" },
      ],
    });
  });

  it("finds the recipient the message names", async () => {
    serve({
      ...SPACES,
      ...people,
      "POST /spaces/s1/conversations/dm": { id: "dm" },
      "POST /spaces/s1/conversations/dm/messages": { message: { id: "m" } },
    });
    await expect(
      call(tool("message.send"), { space: "s1", message: "Thanks, bob lee." }),
    ).resolves.toMatchObject({
      audience: "private",
    });
  });

  it("refuses what it can't send, in words that say why", async () => {
    serve({ ...SPACES, ...people });
    const send = (input: Record<string, unknown>) =>
      call(tool("message.send"), { space: "s1", ...input }).catch(refusal);
    await expect(send({ message: "  " })).resolves.toBe("message is required");
    await expect(send({ message: "x", recipientUserId: "u1" })).resolves.toBe(
      "recipientUserId must identify another member of this Space",
    );
    await expect(send({ message: "x" })).resolves.toBe(
      "choose audience private (with recipientUserId) or space; ask the user if their intent is unclear",
    );
    await expect(send({ message: "x", audience: "private" })).resolves.toBe(
      "a private message requires one resolved recipient",
    );
    await expect(send({ message: "x", audience: "team" })).resolves.toBe(
      "audience must be auto, private, or space",
    );
  });

  it("only mentions a whole @name", () => {
    expect(messageSpans("@Bob Leeds", bob)).toEqual([{ type: "text", text: "@Bob Leeds" }]);
    expect(messageSpans("no name")).toEqual([{ type: "text", text: "no name" }]);
  });
});

describe("threads", () => {
  it("lists them with a count of people and a time in whole seconds", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/conversations": {
        conversations: [
          {
            id: "t",
            title: "Plan",
            kind: "group",
            participants: [{}, {}],
            updated_at: "2026-11-06T10:00:00.123456Z",
            visible_to_space: true,
          },
        ],
      },
    });
    await expect(call(tool("thread.list"), { space: "s1" })).resolves.toEqual({
      threads: [
        {
          id: "t",
          title: "Plan",
          kind: "group",
          participants: 2,
          updated_at: "2026-11-06T10:00:00Z",
        },
      ],
    });
    expect(wholeSeconds("not a time")).toBe("not a time");
  });

  it("reads messages as author and text, cut to 2000 characters", async () => {
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/conversations/t/messages?limit=20": {
        messages: [
          {
            sender_name: "Ada",
            sender_kind: "person",
            created_at: "2026-11-06T10:00:00Z",
            content: [
              { type: "text", text: "Hi " },
              { type: "mention", label: "Bob" },
            ],
          },
          {
            sender_name: "Ada",
            sender_kind: "person",
            created_at: "2026-11-06T10:00:00Z",
            content: [{ type: "text", text: "x".repeat(2500) }],
          },
        ],
      },
    });
    const { messages } = (await call(tool("thread.read"), { space: "s1", thread_id: "t" })) as {
      messages: { text: string; author: string }[];
    };
    expect(messages[0]).toEqual({
      author: "Ada",
      author_kind: "person",
      text: "Hi Bob",
      at: "2026-11-06T10:00:00Z",
    });
    expect(Array.from(messages[1].text)).toHaveLength(2000);
    expect(calls).toHaveLength(2);
  });

  it("tells the model to look a thread up when the id is wrong", async () => {
    const wrong = "no thread with that id that you can use in this Space; call thread_list";
    serve({
      ...SPACES,
      "GET /spaces/s1/conversations/t/messages?limit=20": refusedWith(403, "forbidden"),
      "POST /spaces/s1/conversations/t/messages": refusedWith(404, "not_found"),
    });
    await expect(
      call(tool("thread.read"), { space: "s1", thread_id: "t" }).catch(refusal),
    ).resolves.toBe(wrong);
    await expect(
      call(tool("thread.post"), { space: "s1", thread_id: "t", message: "x" }).catch(refusal),
    ).resolves.toBe(wrong);
  });

  it("creates in the personal Space with its people", async () => {
    const calls = serve({
      ...SPACES,
      "POST /spaces/s0/conversations": { id: "t", title: "Plan", kind: "group" },
    });
    await expect(
      call(tool("thread.create"), { title: "Plan", member_ids: [" u2 "] }),
    ).resolves.toEqual({
      thread: { id: "t", title: "Plan" },
    });
    expect(calls[1].body).toEqual({
      title: "Plan",
      participants: [{ kind: "person", user_id: "u2" }],
    });
    serve({ ...SPACES, "POST /spaces/s0/conversations": refusedWith(400, "invalid_request") });
    await expect(
      call(tool("thread.create"), { title: "Plan", member_ids: ["u2"] }).catch(refusal),
    ).resolves.toBe(
      "a thread needs a title and members of this Space; resolve them with space_member_resolve",
    );
  });

  it("posts as the person's own message", async () => {
    const calls = serve({
      ...SPACES,
      "POST /spaces/s1/conversations/t/messages": { message: { id: "m" } },
    });
    await expect(
      call(tool("thread.post"), { space: "s1", thread_id: "t", message: "Hi" }),
    ).resolves.toEqual({
      posted: "m",
      thread_id: "t",
    });
    expect(calls[1].body).toEqual({ content: [{ type: "text", text: "Hi" }] });
  });
});

describe("members", () => {
  it("lists without emails", async () => {
    serve({ ...SPACES, ...people });
    await expect(call(tool("space.member.list"), { space: "s1" })).resolves.toEqual({
      members: [
        { user_id: "u1", name: "Ada", role: "owner" },
        { user_id: "u2", name: "Bob Lee", role: "member" },
      ],
      count: 2,
    });
  });

  it("resolves a name or email without guessing", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/members": {
        members: [me, bob, { ...bob, user_id: "u3", name: "Bobby", email: "bobby@x.test" }],
      },
    });
    const resolve = (query: string) => call(tool("space.member.resolve"), { space: "s1", query });
    await expect(resolve("BOB@x.test")).resolves.toMatchObject({
      count: 1,
      resolved: true,
      matches: [{ user_id: "u2" }],
    });
    await expect(resolve("bob")).resolves.toMatchObject({ count: 2, resolved: false });
    await expect(resolve("zed")).resolves.toEqual({ matches: [], count: 0, resolved: false });
    await expect(resolve(" ").catch(refusal)).resolves.toBe("member query is required");
  });
});
