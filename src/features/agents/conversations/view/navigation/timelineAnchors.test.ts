// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { createAnchorsBuilder } from "./timelineAnchors";

const msg = (
  id: string,
  content: string,
  role: "user" | "assistant" = "user",
): GlobalAiMessage => ({
  id,
  role,
  mode: "ask",
  content,
  createdAt: "",
});

// The plain algorithm, uncached, to keep copy and targets identical.
function reference(messages: GlobalAiMessage[]) {
  return messages.flatMap((message) => {
    if (message.role !== "user" || !message.content.trim()) return [];
    const lines = message.content
      .split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const first = lines[0] ?? "";
    const description = lines.length > 1 ? lines.slice(1).join(" ") : first.slice(60).trim();
    return [
      {
        id: message.id,
        title: first.length > 60 ? `${first.slice(0, 60)}…` : first,
        ...(description
          ? {
              description: description.length > 160 ? `${description.slice(0, 160)}…` : description,
            }
          : {}),
      },
    ];
  });
}

describe("message anchors", () => {
  it("match the plain previews for long, Unicode, blank and multiline prompts", () => {
    const build = createAnchorsBuilder();
    const texts = [
      "",
      " \n\t",
      "short",
      "text🙂".repeat(90),
      "a".repeat(221),
      " a  b \n \t c  d\n".repeat(80),
    ];
    const messages = texts.map((text, index) => msg(`m${index}`, text));
    expect(build(messages)).toEqual(reference(messages));
  });

  it("keep their identity while an answer grows, and change when prompts do", () => {
    const build = createAnchorsBuilder();
    const user = msg("1", "question");
    const original = build([user, msg("2", "a", "assistant")]);
    expect(build([user, msg("2", "answer", "assistant")])).toBe(original);
    expect(build([msg("0", "older"), user])).toEqual(reference([msg("0", "older"), user]));
    expect(build([msg("1", "edited")])).toEqual(reference([msg("1", "edited")]));
  });

  it("skip turns Misty started itself", () => {
    const build = createAnchorsBuilder();
    expect(build([{ ...msg("1", "Continue"), source: "continuation" }])).toEqual([]);
  });
});
