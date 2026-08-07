import { describe, expect, it } from "vitest";
import { splitMentionSegments } from "@/features/spaces/spaceChat/mentionHighlight";

describe("splitMentionSegments", () => {
  it("marks a known name as a mention", () => {
    const segments = splitMentionSegments("hey @Melissa Chen can you look", ["Melissa Chen"]);
    expect(segments).toEqual([
      { text: "hey ", mention: false },
      { text: "@Melissa Chen", mention: true },
      { text: " can you look", mention: false },
    ]);
  });

  it("does not mark an unknown @word", () => {
    const segments = splitMentionSegments("email me @gmail.com", ["Melissa Chen"]);
    expect(segments).toEqual([{ text: "email me @gmail.com", mention: false }]);
  });

  it("does not partial-match a shorter name inside a longer one", () => {
    const segments = splitMentionSegments("@Matt vs @Matthew Chen", ["Matt", "Matthew Chen"]);
    expect(segments).toEqual([
      { text: "@Matt", mention: true },
      { text: " vs ", mention: false },
      { text: "@Matthew Chen", mention: true },
    ]);
  });

  it("handles multiple mentions of the same person", () => {
    const segments = splitMentionSegments("@Bo and @Bo again", ["Bo"]);
    expect(segments).toEqual([
      { text: "@Bo", mention: true },
      { text: " and ", mention: false },
      { text: "@Bo", mention: true },
      { text: " again", mention: false },
    ]);
  });

  it("returns a single plain segment with no names configured", () => {
    expect(splitMentionSegments("hello @world", [])).toEqual([
      { text: "hello @world", mention: false },
    ]);
  });
});
