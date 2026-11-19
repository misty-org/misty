import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import type * as Karaoke from "@opencut/text/karaoke";
import type * as Stroke from "@opencut/text/stroke";
import type * as CaptionStyle from "@opencut/subtitles/caption-style";
import type * as GroupWords from "@opencut/transcription/group-words";

const require = createRequire(import.meta.url);
let karaoke: typeof Karaoke;
let stroke: typeof Stroke;
let styles: typeof CaptionStyle;
let grouping: typeof GroupWords;
let tick: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  karaoke = await import("@opencut/text/karaoke");
  stroke = await import("@opencut/text/stroke");
  styles = await import("@opencut/subtitles/caption-style");
  grouping = await import("@opencut/transcription/group-words");
  tick = (await import("@opencut/wasm")).TICKS_PER_SECOND;
});

const word = (text: string, start: number, end: number) => ({ text, start, end });

describe("a caption keeps its words' times", () => {
  it("lines them up with its text, from the caption's own start", () => {
    expect(
      karaoke.alignCaptionWords({
        text: "we went\nhome",
        words: [word("we", 10, 10.2), word("went", 10.2, 10.5), word("home", 10.6, 11)],
        startTime: 10,
        duration: 1,
      }),
    ).toEqual([
      { start: 0, end: 0.2 },
      { start: 0.2, end: 0.5 },
      { start: 0.6, end: 1 },
    ]);
  });

  it("counts a word with a space in it as two, both at its time", () => {
    expect(
      karaoke.alignCaptionWords({
        text: "New York",
        words: [word("New York", 1, 1.5)],
        startTime: 1,
        duration: 0.5,
      }),
    ).toEqual([
      { start: 0, end: 0.5 },
      { start: 0, end: 0.5 },
    ]);
  });

  it("keeps none when the words don't match the text", () => {
    expect(
      karaoke.alignCaptionWords({
        text: "three words here",
        words: [word("two", 0, 1), word("words", 1, 2)],
        startTime: 0,
        duration: 2,
      }),
    ).toBeNull();
    expect(
      karaoke.alignCaptionWords({ text: "hi", words: undefined, startTime: 0, duration: 1 }),
    ).toBeNull();
  });

  it("holds times inside the caption and in order", () => {
    expect(
      karaoke.alignCaptionWords({
        text: "a b",
        words: [word("a", -1, 0.5), word("b", 0.2, 9)],
        startTime: 0,
        duration: 1,
      }),
    ).toEqual([
      { start: 0, end: 0.5 },
      { start: 0.2, end: 1 },
    ]);
  });

  it("stores them as compact JSON and reads them back", () => {
    const times = [
      { start: 0, end: 0.2004 },
      { start: 0.25, end: 0.7 },
    ];
    const encoded = karaoke.encodeCaptionWords(times);
    expect(encoded).toBe("[[0,0.2],[0.25,0.7]]");
    expect(karaoke.decodeCaptionWords(encoded)).toEqual([
      { start: 0, end: 0.2 },
      { start: 0.25, end: 0.7 },
    ]);
  });

  it("reads nothing from malformed or out-of-bounds times", () => {
    for (const value of [
      undefined,
      3,
      "",
      "not json",
      "{}",
      "[]",
      "[[1]]",
      '[["a",1]]',
      "[[1,0.5]]",
      "[[-1,0]]",
      "[[0.5,1],[0.2,1]]",
      `[[0,${karaoke.MAX_CAPTION_WORD_SECONDS + 1}]]`,
      JSON.stringify(Array.from({ length: karaoke.MAX_CAPTION_WORDS + 1 }, () => [0, 0])),
    ])
      expect(karaoke.decodeCaptionWords(value)).toBeNull();
  });
});

describe("karaoke lights the words already said", () => {
  const words = [
    { start: 0, end: 0.3 },
    { start: 0.3, end: 0.6 },
    { start: 0.8, end: 1 },
  ];

  it("counts the words begun by a moment", () => {
    expect(karaoke.spokenWordCount({ words, seconds: -0.1 })).toBe(0);
    expect(karaoke.spokenWordCount({ words, seconds: 0 })).toBe(1);
    expect(karaoke.spokenWordCount({ words, seconds: 0.7 })).toBe(2);
    expect(karaoke.spokenWordCount({ words, seconds: 5 })).toBe(3);
  });

  it("cuts each line where its said words end", () => {
    expect(karaoke.splitSpokenLines({ lines: ["one two", "three four"], spokenWords: 3 })).toEqual([
      { spoken: "one two", rest: "" },
      { spoken: "three", rest: " four" },
    ]);
    expect(karaoke.splitSpokenLines({ lines: ["one two"], spokenWords: 0 })).toEqual([
      { spoken: "", rest: "one two" },
    ]);
  });

  const caption = (params: Record<string, string | number | boolean>, trimStart = 0) => ({
    params: {
      content: "one two\nthree",
      "karaoke.enabled": true,
      "karaoke.color": "#ff0000",
      [karaoke.CAPTION_WORDS_KEY]: karaoke.encodeCaptionWords(words),
      ...params,
    },
    trimStart: trimStart as never,
  });

  it("follows the caption's time, through a trimmed start", () => {
    expect(karaoke.resolveKaraoke({ element: caption({}), elapsedTicks: 0.4 * tick })).toEqual({
      spokenWords: 2,
      color: "#ff0000",
    });
    expect(
      karaoke.resolveKaraoke({ element: caption({}, 0.5 * tick), elapsedTicks: 0.4 * tick }),
    ).toEqual({ spokenWords: 3, color: "#ff0000" });
  });

  it("draws plain when it's off, has no times, or was retyped", () => {
    expect(
      karaoke.resolveKaraoke({ element: caption({ "karaoke.enabled": false }), elapsedTicks: 0 }),
    ).toBeUndefined();
    expect(
      karaoke.resolveKaraoke({
        element: caption({ [karaoke.CAPTION_WORDS_KEY]: "" }),
        elapsedTicks: 0,
      }),
    ).toBeUndefined();
    expect(
      karaoke.resolveKaraoke({ element: caption({ content: "one two" }), elapsedTicks: 0 }),
    ).toBeUndefined();
  });
});

describe("text takes an outline", () => {
  it("draws none unless it's on", () => {
    expect(stroke.readTextStroke({ params: {}, scaledFontSize: 60 })).toBeNull();
  });

  it("sizes it to the font, within bounds", () => {
    expect(
      stroke.readTextStroke({
        params: { "stroke.enabled": true, "stroke.color": "#112233", "stroke.width": 10 },
        scaledFontSize: 60,
      }),
    ).toEqual({ color: "#112233", lineWidth: 6 });
    expect(
      stroke.readTextStroke({
        params: { "stroke.enabled": true, "stroke.width": 1000 },
        scaledFontSize: 100,
      }),
    ).toEqual({ color: "#000000", lineWidth: 40 });
  });
});

describe("caption styles", () => {
  it("names the four styles", () => {
    expect(styles.CAPTION_STYLES.map((style) => style.value)).toEqual([
      "plain",
      "serif",
      "bold",
      "karaoke",
    ]);
    expect(styles.isCaptionStyle("bold")).toBe(true);
    expect(styles.isCaptionStyle("neon")).toBe(false);
  });

  it("turns outline and karaoke on only where the style has them", () => {
    expect(styles.captionStyleParams({ style: "plain" })).toMatchObject({
      "caption.style": "plain",
      "stroke.enabled": false,
      "karaoke.enabled": false,
    });
    expect(styles.captionStyleParams({ style: "bold" })).toMatchObject({
      "stroke.enabled": true,
      "karaoke.enabled": false,
    });
    expect(styles.captionStyleParams({ style: "karaoke" })).toMatchObject({
      "stroke.enabled": true,
      "karaoke.enabled": true,
    });
  });

  it("lets a subtitle file's own style win over the preset", () => {
    const merged = styles.captionStyleOverrides({
      style: "serif",
      own: { color: "#00ff00", background: { enabled: true, color: "#222222" } },
    });
    expect(merged.fontFamily).toBe("Georgia");
    expect(merged.color).toBe("#00ff00");
    expect(merged.background).toMatchObject({ enabled: true, color: "#222222", paddingX: 54 });
  });
});

describe("recognized words become timed captions", () => {
  it("keeps each phrase's words", () => {
    const phrases = grouping.groupWordsIntoTimedPhrases([
      word("hello", 0, 0.4),
      word(" there.", 0.4, 0.8),
      word("again", 2, 2.3),
    ]);
    expect(phrases).toEqual([
      {
        text: "hello there.",
        start: 0,
        end: 0.8,
        words: [word("hello", 0, 0.4), word("there.", 0.4, 0.8)],
      },
      { text: "again", start: 2, end: 2.3, words: [word("again", 2, 2.3)] },
    ]);
  });

  it("holds short captions a little longer, never into the next one", () => {
    const chunks = grouping.captionChunksFromPhrases({
      segments: [
        { text: "hi", start: 0, end: 0.2, words: [word("hi", 0, 0.2)] },
        { text: "you", start: 0.5, end: 0.7, words: [word("you", 0.5, 0.7)] },
      ],
    });
    expect(chunks.map((chunk) => chunk.startTime)).toEqual([0, 0.5]);
    expect(chunks[0].duration).toBeCloseTo(0.5);
    expect(chunks[1].duration).toBeCloseTo(0.8);
    expect(chunks[1].words).toEqual([word("you", 0.5, 0.7)]);
  });

  it("falls back to OpenCut's chunking without word times", () => {
    const chunks = grouping.captionChunksFromPhrases({
      segments: [{ text: "one two three four", start: 0, end: 4 }],
    });
    expect(chunks.map((chunk) => chunk.text)).toEqual(["one two three", "four"]);
    expect(chunks[0].words).toBeUndefined();
  });
});
