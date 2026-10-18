import { describe, expect, it } from "vitest";
import { matchVocative } from "./vocative";

const agents = [
  { id: "a1", name: "Juniper" },
  { id: "a2", name: "Research Bot" },
  { id: "a3", name: "Kai" },
];

describe("matchVocative", () => {
  it("routes a greeting plus an agent name to that agent", () => {
    expect(matchVocative("Hey Juniper, find a time with Sam on Thursday.", agents)).toEqual({
      agent: agents[0],
      message: "find a time with Sam on Thursday.",
    });
  });

  it("forgives speech-to-text spellings of longer names", () => {
    expect(matchVocative("hey juniper find a time", agents)?.agent.id).toBe("a1");
    expect(matchVocative("Hey Junipur, find a time", agents)?.agent.id).toBe("a1");
    expect(matchVocative("Hey Research Bott, summarize this page", agents)?.agent.id).toBe("a2");
  });

  it("is strict about short names", () => {
    expect(matchVocative("Hey Kai, open the notes", agents)?.agent.id).toBe("a3");
    expect(matchVocative("Hey Kay, open the notes", agents)).toBeNull();
  });

  it("works with greetings in other languages and accents", () => {
    expect(matchVocative("Oye Juniper, busca una hora", agents)?.message).toBe("busca una hora");
    expect(matchVocative("Olá Juniper, marca uma reunião", agents)?.agent.id).toBe("a1");
    expect(matchVocative("Salut Juniper, trouve un créneau", agents)?.agent.id).toBe("a1");
  });

  it("only matches at the start and needs a message", () => {
    expect(matchVocative("I told Juniper about it yesterday", agents)).toBeNull();
    expect(matchVocative("Hey Juniper", agents)).toBeNull();
    expect(matchVocative("Hey there, how are you", agents)).toBeNull();
    expect(matchVocative("Hey Juniper, ", agents)).toBeNull();
  });

  it("refuses an ambiguous match", () => {
    const twins = [
      { id: "x", name: "Robin" },
      { id: "y", name: "Robyn" },
    ];
    expect(matchVocative("Hey Robon, do it", twins)).toBeNull();
    expect(matchVocative("Hey Robin, do it", twins)?.agent.id).toBe("x");
  });
});
