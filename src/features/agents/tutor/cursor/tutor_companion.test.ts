import { describe, expect, it } from "vitest";
import type {
  GlobalAiConversation,
  GlobalAiMessage,
} from "../../conversations/state/conversation_types";
import { taskTag } from "./companion_conversation";
import { keptTutorTurns, tutorConversationOf, tutorTurns } from "./tutor_conversation";
import { handoffStateOf } from "./tutor_handoff_state";

const day = 24 * 60 * 60 * 1000;
const at = (ago: number) => new Date(Date.now() - ago).toISOString();
const message = (
  id: string,
  role: GlobalAiMessage["role"],
  content: string,
  ago: number,
  extra: Partial<GlobalAiMessage> = {},
): GlobalAiMessage => ({ id, role, mode: "ask", content, createdAt: at(ago), ...extra });
const conversation = (
  id: string,
  messages: GlobalAiMessage[],
  extra: Partial<GlobalAiConversation> = {},
): GlobalAiConversation => ({
  id,
  title: "Tutor",
  createdAt: at(day * 3),
  updatedAt: at(0),
  messages,
  remote: false,
  ...extra,
});

describe("Tutor's conversation", () => {
  it("is the most recent chat with Tutor's place, never another chat", () => {
    const older = conversation("old", [], { place: "tutor", updatedAt: at(1000) });
    const newer = conversation("new", [], { place: "tutor", updatedAt: at(10) });
    const chat = conversation("chat", [], { updatedAt: at(0) });
    expect(tutorConversationOf([older, chat, newer])?.id).toBe("new");
    expect(tutorConversationOf([chat])).toBeUndefined();
  });

  it("keeps only the last day of turns", () => {
    const kept = keptTutorTurns(
      conversation("t", [
        message("1", "user", "old question", day + 1000),
        message("2", "assistant", "old answer", day + 900),
        message("3", "user", "new question", 1000),
      ]),
    );
    expect(kept.messages.map((m) => m.id)).toEqual(["3"]);
  });

  it("lists turns newest first, with where handed-off work went", () => {
    const turns = tutorTurns(
      conversation("t", [
        message("1", "user", "what's this button?", 5000),
        message("2", "assistant", "It saves the file.", 4900),
        message("3", "user", "fix the export bug", 1000),
        message("4", "assistant", "Ada has it.", 900, {
          tutorHandoff: { agentId: "ada", conversationId: "thread" },
        }),
      ]),
    );
    expect(turns.map((turn) => turn.asked)).toEqual(["fix the export bug", "what's this button?"]);
    expect(turns[0]).toMatchObject({
      answered: "Ada has it.",
      handoff: { agentId: "ada", conversationId: "thread" },
    });
    expect(turns[1]?.handoff).toBeUndefined();
  });
});

describe("task tags", () => {
  it("reads the request, and the agent when one is named", () => {
    expect(taskTag("TASK", "Sure. [TASK: tidy my downloads]")).toEqual({
      request: "tidy my downloads",
    });
    expect(taskTag("TASK", "On it. [TASK @Ada: fix the export bug]")).toEqual({
      request: "fix the export bug",
      agent: "Ada",
    });
    expect(taskTag("DRIVE", "[DRIVE @Big Bob: rename the layer]")).toEqual({
      request: "rename the layer",
      agent: "Big Bob",
    });
    expect(taskTag("TASK", "No tag here.")).toBeUndefined();
  });
});

describe("a hand-off's state", () => {
  const reply = (extra: Partial<GlobalAiMessage>) => message("r", "assistant", "", 0, extra);
  it("follows the reply in the agent's thread", () => {
    expect(handoffStateOf(undefined)).toBe("working");
    expect(handoffStateOf(reply({ state: "streaming" }))).toBe("working");
    expect(handoffStateOf(reply({ state: "completed" }))).toBe("done");
    expect(handoffStateOf(reply({ state: "canceled" }))).toBe("failed");
    expect(
      handoffStateOf(
        reply({
          state: "streaming",
          screenRequest: { kind: "look", reason: "", location: "ask", state: "pending" },
        }),
      ),
    ).toBe("waiting");
  });
});
