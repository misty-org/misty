import { describe, expect, it } from "vitest";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { BOARD_MS, boardOf, chatsOf, studioChatOf } from "./studioTalk";

const chat = (id: string, agentId: string, updatedAt: string) =>
  ({ id, agentId, updatedAt, title: id, messages: [] }) as unknown as GlobalAiConversation;

const chats = [
  chat("old", "ada", "2026-11-01T00:00:00Z"),
  chat("new", "ada", "2026-11-10T00:00:00Z"),
  chat("run", "ada", "2026-11-05T00:00:00Z"),
  chat("bo", "bo", "2026-11-11T00:00:00Z"),
];

describe("which chat the studio talks in", () => {
  it("lists an agent's own chats, newest first", () => {
    expect(chatsOf(chats, "ada").map((item) => item.id)).toEqual(["new", "run", "old"]);
  });

  it("prefers the chat picked in the studio, then its latest run's, then its newest", () => {
    const none = { chats: {}, fresh: {} };
    expect(studioChatOf("ada", "", chats, none)?.id).toBe("new");
    expect(studioChatOf("ada", "run", chats, none)?.id).toBe("run");
    expect(studioChatOf("ada", "run", chats, { chats: { ada: "old" }, fresh: {} })?.id).toBe("old");
  });

  it("starts fresh when asked, and never uses another agent's chat", () => {
    expect(studioChatOf("ada", "run", chats, { chats: {}, fresh: { ada: true } })).toBeUndefined();
    expect(studioChatOf("ada", "bo", chats, { chats: { ada: "bo" }, fresh: {} })?.id).toBe("new");
  });
});

describe("the meeting room's board", () => {
  const reply = (state: string) => ({ role: "assistant", state, content: "" });
  const withReply = (id: string, state: string) =>
    ({
      id,
      agentId: id,
      updatedAt: "",
      messages: [reply(state)],
    }) as unknown as GlobalAiConversation;

  it("shows the newest group task with where each part stands", () => {
    const now = Date.now();
    const board = boardOf(
      [{ id: "h", task: "Ship it", chats: { ada: "a", bo: "b", cy: "c" }, startedAt: now }],
      [withReply("a", "streaming"), withReply("b", "completed"), withReply("c", "failed")],
      now,
    );
    expect(board).toEqual({
      task: "Ship it",
      rows: [
        { agentId: "ada", state: "working" },
        { agentId: "bo", state: "done" },
        { agentId: "cy", state: "failed" },
      ],
    });
  });

  it("is empty with no group task of the day", () => {
    expect(boardOf([], [], Date.now())).toBeNull();
    const old = { id: "h", task: "Old", chats: {}, startedAt: 0 };
    expect(boardOf([old], [], BOARD_MS + 1)).toBeNull();
  });
});
