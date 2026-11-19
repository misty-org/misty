import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as CaptionsModule from "./captions";
import type * as ToolsModule from "./index";
import type * as ProjectModel from "./projectModel";
import type { VideoProjectDocument } from "../projectDocumentTypes";

vi.mock("@opencut/media/processing", () => ({
  processMediaAssets: vi.fn(async ({ files }: { files: File[] }) =>
    files.map((file) => ({
      name: file.name,
      type: "video",
      duration: 4,
      width: 1280,
      height: 720,
      file,
    })),
  ),
}));

const require = createRequire(import.meta.url);
let captions: typeof CaptionsModule;
let tools: typeof ToolsModule;
let model: typeof ProjectModel;
let tick: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  captions = await import("./captions");
  tools = await import("./index");
  model = await import("./projectModel");
  tick = (await import("@opencut/wasm")).TICKS_PER_SECOND;
});

const canvas = { width: 1920, height: 1080 };
const loadMedia = async (itemId: string) => new File(["x"], itemId);
const context = { loadMedia };

const said = (text: string, start: number, end: number) => ({ text, start, end });
const phrases = () => [
  {
    text: "hello there",
    start: 1,
    end: 2,
    words: [said("hello", 1, 1.4), said("there", 1.5, 2)],
  },
  { text: "bye", start: 2.5, end: 3, words: [said("bye", 2.5, 3)] },
];

async function video(): Promise<VideoProjectDocument> {
  return tools.editVideoProject(
    { kind: "misty.video", version: 1, project: null, media: [] },
    [{ op: "add", item_id: "a.mp4" }],
    loadMedia,
  );
}

/** The video with captions laid on it, as the captions edit does. */
async function captioned(style?: string): Promise<VideoProjectDocument> {
  const document = model.copyDocument(await video());
  const project = model.projectOf(document);
  const scene = model.sceneOf(project);
  scene.tracks = captions.addCaptionTrack(
    scene.tracks,
    { phrases: phrases(), style },
    project.settings.canvasSize,
  );
  return document;
}

const captionClips = (document: VideoProjectDocument) => {
  const track = model.sceneOf(model.projectOf(document)).tracks.overlay[0];
  expect(track.name).toBe("Captions");
  return track.elements;
};

describe("agents make captions in a style", () => {
  it("lays one clip per phrase, in time order, plain by default", () => {
    const elements = captions.buildCaptionElements(
      { phrases: [phrases()[1], phrases()[0]] },
      canvas,
    );
    expect(elements.map((clip) => [clip.startTime / tick, clip.duration / tick])).toEqual([
      [1, 1],
      [2.5, 0.5],
    ]);
    expect(elements[0].params).toMatchObject({
      content: "hello there",
      "caption.style": "plain",
      "karaoke.enabled": false,
    });
    expect(new Set(elements.map((clip) => clip.id)).size).toBe(2);
  });

  it("keeps each phrase's word times from its own start, for karaoke", () => {
    const [first] = captions.buildCaptionElements({ phrases: phrases(), style: "karaoke" }, canvas);
    expect(first.params).toMatchObject({
      "caption.style": "karaoke",
      "karaoke.enabled": true,
      "stroke.enabled": true,
      "caption.words": "[[0,0.4],[0.5,1]]",
    });
  });

  it("sets each style's look", () => {
    const look = (style: string) =>
      captions.buildCaptionElements({ phrases: phrases(), style }, canvas)[0].params;
    expect(look("serif")).toMatchObject({ fontFamily: "Georgia", "background.enabled": true });
    expect(look("bold")).toMatchObject({ fontSize: 6.5, "stroke.enabled": true });
    expect(look("plain")).toMatchObject({ fontFamily: "Arial", "stroke.enabled": false });
  });

  it("holds a word just outside its phrase inside it", () => {
    const [clip] = captions.buildCaptionElements(
      { phrases: [{ text: "hi", start: 1, end: 2, words: [said("hi", 0.98, 2.03)] }] },
      canvas,
    );
    expect(clip.params["caption.words"]).toBe("[[0,1]]");
  });

  it("joins phrases that only touch", () => {
    const elements = captions.buildCaptionElements(
      {
        phrases: [
          { text: "a", start: 0, end: 1.0005 },
          { text: "b", start: 1, end: 2 },
        ],
      },
      canvas,
    );
    expect(elements[0].startTime + elements[0].duration).toBeLessThanOrEqual(elements[1].startTime);
  });

  it.each([
    ["no phrases", { phrases: [] }, /at least one phrase/],
    ["phrases that aren't a list", { phrases: "hello" }, /at least one phrase/],
    ["a phrase with no text", { phrases: [{ text: "", start: 0, end: 1 }] }, /needs its text/],
    [
      "a phrase too long",
      { phrases: [{ text: "x".repeat(301), start: 0, end: 1 }] },
      /longer than 300/,
    ],
    [
      "a phrase with no length",
      { phrases: [{ text: "hi", start: 1, end: 1 }] },
      /start before its end/,
    ],
    [
      "a phrase before the video",
      { phrases: [{ text: "hi", start: -1, end: 1 }] },
      /before the video/,
    ],
    [
      "a phrase with no end",
      { phrases: [{ text: "hi", start: 0, end: Number.NaN }] },
      /start and end in seconds/,
    ],
    [
      "overlapping phrases",
      {
        phrases: [
          { text: "a", start: 0, end: 2 },
          { text: "b", start: 1, end: 3 },
        ],
      },
      /overlap/,
    ],
    ["an unknown style", { phrases: phrases(), style: "neon" }, /plain, serif, bold, karaoke/],
    [
      "karaoke without words",
      { phrases: [{ text: "hi", start: 0, end: 1 }], style: "karaoke" },
      /words with their times/,
    ],
    [
      "words that don't spell the phrase",
      { phrases: [{ text: "hi there", start: 0, end: 1, words: [said("hi", 0, 0.5)] }] },
      /don't match its text/,
    ],
    [
      "a word outside its phrase",
      { phrases: [{ text: "hi", start: 1, end: 2, words: [said("hi", 0, 0.5)] }] },
      /outside its phrase/,
    ],
    [
      "words out of order",
      {
        phrases: [{ text: "a b", start: 0, end: 2, words: [said("a", 1, 1.5), said("b", 0.5, 1)] }],
      },
      /order they're said/,
    ],
    [
      "words that aren't a list",
      { phrases: [{ text: "a", start: 0, end: 1, words: "a" }] },
      /list of/,
    ],
    [
      "too many phrases",
      {
        phrases: Array.from({ length: 2001 }, (_, index) => ({
          text: "a",
          start: index,
          end: index + 0.5,
        })),
      },
      /at most 2000/,
    ],
  ])("refuses %s", (_name, input, message) => {
    expect(() => captions.buildCaptionElements(input, canvas)).toThrow(message);
  });
});

describe("agents restyle the captions already there", () => {
  it("lays every caption out again in the new style, keeping its timing and words", async () => {
    const before = await captioned("karaoke");
    const after = await captions.restyleCaptions(before, { style: "bold" }, context);
    const [was] = captionClips(before);
    const [now] = captionClips(after);
    expect(now.id).toBe(was.id);
    expect([now.startTime, now.duration]).toEqual([was.startTime, was.duration]);
    expect(now.params).toMatchObject({
      "caption.style": "bold",
      "karaoke.enabled": false,
      "stroke.enabled": true,
      fontSize: 6.5,
      "caption.words": was.params["caption.words"],
    });
    expect(captionClips(before)[0].params["caption.style"]).toBe("karaoke");
  });

  it("keeps what isn't the caption's look", async () => {
    const before = await captioned("plain");
    const scene = model.sceneOf(model.projectOf(before));
    const clip = scene.tracks.overlay[0].elements[0];
    clip.params = { ...clip.params, "transition.in": "fade", opacity: 0.5 };
    const after = await captions.restyleCaptions(before, { style: "serif" }, context);
    expect(captionClips(after)[0].params).toMatchObject({
      "transition.in": "fade",
      opacity: 0.5,
      fontFamily: "Georgia",
    });
  });

  it("refuses an unknown style or a video with no captions", async () => {
    await expect(
      captions.restyleCaptions(await captioned(), { style: "neon" }, context),
    ).rejects.toThrow(/plain, serif, bold, karaoke/);
    await expect(
      captions.restyleCaptions(await video(), { style: "bold" }, context),
    ).rejects.toThrow(/no captions/);
  });
});
