import { describe, expect, it } from "vitest";
import { historyTurns } from "./localChats";
import type { GlobalAiConversation, GlobalAiMessage } from "./types";

function message(id: string, role: "user" | "assistant", extra: Partial<GlobalAiMessage> = {}) {
  return {
    id,
    role,
    mode: "ask",
    content: id,
    createdAt: `2026-11-06T00:00:${id.padStart(2, "0")}.000Z`,
    state: "completed",
    ...extra,
  } as GlobalAiMessage;
}

function conversation(extra: Partial<GlobalAiConversation> = {}) {
  return {
    id: "chat",
    title: "New conversation",
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
    messages: [],
    ...extra,
  } as GlobalAiConversation;
}

describe("historyTurns", () => {
  it("sends finished turns oldest first, and never the one being asked", () => {
    const turns = historyTurns(
      conversation({
        messages: [
          message("1", "user"),
          message("2", "assistant", { invocationId: "first", content: "answer" }),
          message("3", "user", { source: "continuation" }),
          message("4", "assistant", { invocationId: "continued" }),
          message("5", "user"),
          message("6", "assistant", { invocationId: "running", state: "streaming" }),
        ],
      }),
    );
    expect(turns).toEqual([
      {
        invocation_id: "first",
        prompt: "1",
        reply: "answer",
        created_at: "2026-11-06T00:00:01.000Z",
      },
    ]);
  });

  it("stops at the size limit, keeping the newest turns", () => {
    const big = "x".repeat(300_000);
    const turns = historyTurns(
      conversation({
        messages: [
          message("1", "user", { content: `old ${big}` }),
          message("2", "assistant", { invocationId: "a" }),
          message("3", "user", { content: `new ${big}` }),
          message("4", "assistant", { invocationId: "b" }),
        ],
      }),
    );
    expect(turns.map((turn) => turn.invocation_id)).toEqual(["b"]);
  });

  it("has nothing to send for a new chat", () => {
    expect(historyTurns(undefined)).toEqual([]);
  });
});
