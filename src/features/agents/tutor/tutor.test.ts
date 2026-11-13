import { describe, expect, it } from "vitest";
import { dueCards, newReview, schedule } from "./spacedReview";
import {
  askPrompt,
  chatStyleInstructions,
  notebookContext,
  parseDeck,
  parseMarkdown,
  parseQuiz,
} from "./tutorPrompts";
import type { Notebook } from "./tutorTypes";

const start = new Date("2026-11-11T12:00:00Z");
const day = 86_400_000;

describe("spaced review", () => {
  it("grows the interval with each pass", () => {
    const first = schedule(newReview(start), "good", start);
    expect(first.interval).toBe(1);
    const second = schedule(first, "good", start);
    expect(second.interval).toBe(3);
    const third = schedule(second, "good", start);
    expect(third.interval).toBe(Math.round(3 * 2.5));
    expect(Date.parse(third.due) - start.getTime()).toBe(third.interval * day);
  });

  it("starts a missed card over, makes it harder and brings it back soon", () => {
    const learned = schedule(schedule(newReview(start), "good", start), "good", start);
    const missed = schedule(learned, "again", start);
    expect(missed.reps).toBe(0);
    expect(missed.lapses).toBe(1);
    expect(missed.ease).toBeCloseTo(2.3);
    expect(Date.parse(missed.due) - start.getTime()).toBe(10 * 60_000);
  });

  it("never lets ease fall below 1.3", () => {
    let review = newReview(start);
    for (let i = 0; i < 20; i++) review = schedule(review, "again", start);
    expect(review.ease).toBe(1.3);
  });

  it("lists due cards longest overdue first", () => {
    const card = (id: string, due: string) => ({
      id,
      front: id,
      back: id,
      review: { ...newReview(start), due },
    });
    const due = dueCards(
      [
        card("later", "2026-12-01T00:00:00Z"),
        card("new", "2026-11-10T00:00:00Z"),
        card("old", "2026-11-01T00:00:00Z"),
      ],
      start,
    );
    expect(due.map((c) => c.id)).toEqual(["old", "new"]);
  });
});

describe("reading replies", () => {
  it("reads a deck from a fenced block among other text", () => {
    const reply =
      "Here you go.\n\n```json\n" +
      JSON.stringify({
        title: "Rust ownership",
        cards: [
          { front: "Who frees a value?", back: "Its owner, when it goes out of scope." },
          { front: "", back: "dropped" },
        ],
      }) +
      "\n```\nEnjoy.";
    expect(parseDeck(reply)).toEqual({
      title: "Rust ownership",
      cards: [{ front: "Who frees a value?", back: "Its owner, when it goes out of scope." }],
    });
  });

  it("reads a bare object, and nothing from prose", () => {
    expect(parseDeck('{"cards":[{"front":"a","back":"b"}]}')?.cards).toHaveLength(1);
    expect(parseDeck("I couldn't make cards for that.")).toBeNull();
  });

  it("keeps only quiz questions whose answer is one of their choices", () => {
    const quiz = parseQuiz(
      JSON.stringify({
        title: "Q",
        questions: [
          { question: "2+2?", choices: ["3", "4"], answer: 1, explanation: "Sums." },
          { question: "Bad", choices: ["a", "b"], answer: 5 },
          { question: "One choice", choices: ["a"], answer: 0 },
        ],
      }),
    );
    expect(quiz?.questions).toEqual([
      { question: "2+2?", choices: ["3", "4"], answer: 1, explanation: "Sums." },
    ]);
  });

  it("takes a guide's title from its first heading", () => {
    expect(parseMarkdown("# Borrowing in Rust\n\nText")?.title).toBe("Borrowing in Rust");
    expect(parseMarkdown("   ")).toBeNull();
  });
});

describe("notebook context", () => {
  const notebook: Notebook = {
    id: "n",
    title: "Biology",
    sources: [
      {
        id: "a",
        kind: "text",
        title: "Cells",
        text: "Cells are small.",
        context: "full",
        createdAt: "",
      },
      {
        id: "b",
        kind: "file",
        title: "Long paper",
        text: "Everything in detail.",
        summary: "A short summary.",
        context: "summary",
        createdAt: "",
      },
      {
        id: "c",
        kind: "link",
        title: "Left out",
        url: "https://example.com",
        context: "off",
        createdAt: "",
      },
      {
        id: "d",
        kind: "link",
        title: "Wiki",
        url: "https://example.org/x",
        context: "full",
        createdAt: "",
      },
    ],
    notes: [],
    transformations: [],
    chats: [],
    createdAt: "",
    updatedAt: "",
  };

  it("numbers sources by their place and sends each at its chosen depth", () => {
    const context = notebookContext(notebook);
    expect(context).toContain("[1] Cells\nCells are small.");
    expect(context).toContain("[2] Long paper\nSummary:\nA short summary.");
    expect(context).not.toContain("Everything in detail.");
    expect(context).not.toContain("Left out");
    expect(context).toContain("[4] Wiki (https://example.org/x)\nRead this page yourself.");
  });

  it("asks for citations by number", () => {
    expect(askPrompt(notebook, "What is a cell?")).toMatch(/\[1\]/);
    expect(askPrompt(notebook, "What is a cell?")).toContain("Question: What is a cell?");
  });

  it("answers in the notebook's chat style, or the default way without one", () => {
    expect(chatStyleInstructions(undefined)).toBe("");
    expect(chatStyleInstructions({ goal: "guide", length: "default" })).toMatch(/tutor/);
    expect(
      chatStyleInstructions({ goal: "custom", custom: "Use analogies", length: "shorter" }),
    ).toBe(
      "The person asks you to answer this way: Use analogies Keep the answer short: a few sentences.",
    );
    expect(chatStyleInstructions({ goal: "custom", custom: "  ", length: "default" })).toBe("");
    const styled = {
      ...notebook,
      chatStyle: { goal: "default" as const, length: "longer" as const },
    };
    expect(askPrompt(styled, "Why?")).toContain("Give a full, detailed answer.");
  });
});
