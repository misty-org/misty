import { describe, expect, it } from "vitest";
import { savedTurns, speakerLabel, speakersOf } from "./transcriptTurns";

describe("transcript turns", () => {
  it("names the microphone as the person and numbers other voices", () => {
    expect(speakerLabel("you")).toBe("You");
    expect(speakerLabel("you:2")).toBe("You");
    expect(speakerLabel("system:2")).toBe("Speaker 2");
    expect(speakerLabel("system:?")).toBe("Speaker");
  });

  it("saves turns in seconds and drops empty ones", () => {
    const turns = savedTurns([
      {
        speaker: "system:1",
        channel: "system",
        startMs: 0,
        endMs: 2500,
        text: " Morning. ",
        final: true,
        segmentIds: ["a"],
      },
      {
        speaker: "you",
        channel: "mic",
        startMs: 3000,
        endMs: 2000,
        text: "Hi.",
        final: false,
        segmentIds: ["b"],
      },
      {
        speaker: "system:2",
        channel: "system",
        startMs: 4000,
        endMs: 4100,
        text: "  ",
        final: true,
        segmentIds: ["c"],
      },
    ]);
    expect(turns).toEqual([
      { speaker: "Speaker 1", channel: "system", start: 0, end: 2.5, text: "Morning." },
      { speaker: "You", channel: "mic", start: 3, end: 3, text: "Hi." },
    ]);
    expect(speakersOf([...turns, turns[0]])).toEqual(["Speaker 1", "You"]);
  });
});
