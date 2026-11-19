import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as ToolsModule from "./index";
import type * as BeatEditsModule from "./beatEdits";
import type * as MusicModule from "./music";
import type { FootageAnalysis } from "../analysis/types";
import type { VideoProjectDocument } from "../projectDocumentTypes";

/** What each test file sounds like, by its name: the analysis the edits read. */
const sounds = vi.hoisted(() => new Map<string, FootageAnalysis>());

vi.mock("@opencut/media/processing", () => ({
  processMediaAssets: vi.fn(async ({ files }: { files: File[] }) =>
    files.map((file) =>
      file.name.endsWith(".mp3")
        ? { name: file.name, type: "audio", duration: file.name.startsWith("short") ? 3 : 10, file }
        : { name: file.name, type: "video", duration: 4, width: 1280, height: 720, file },
    ),
  ),
}));

vi.mock("../analysis/analyse", () => ({
  analyseFootage: vi.fn(
    async (file: File): Promise<FootageAnalysis> =>
      sounds.get(file.name) ?? { duration: 0, visual: null, audio: null },
  ),
}));

const require = createRequire(import.meta.url);
let tools: typeof ToolsModule;
let edits: typeof BeatEditsModule;
let music: typeof MusicModule;
let tick: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  tools = await import("./index");
  edits = await import("./beatEdits");
  music = await import("./music");
  tick = (await import("@opencut/wasm")).TICKS_PER_SECOND;
});

const loadMedia = async (itemId: string) => new File(["x"], itemId);
const context = { loadMedia };
const empty = (): VideoProjectDocument => ({
  kind: "misty.video",
  version: 1,
  project: null,
  media: [],
});

/** Beat times from `from`, every `step` seconds, until `until`. */
const beatsFrom = (from: number, step: number, until: number) =>
  Array.from(
    { length: Math.floor((until - from) / step) + 1 },
    (_, i) => Math.round((from + i * step) * 1000) / 1000,
  );

function sound(
  name: string,
  duration: number,
  heard: { silences?: Array<[number, number]>; beats?: number[] } = {},
) {
  sounds.set(name, {
    duration,
    visual: null,
    audio: {
      duration,
      step: 0.1,
      loudness: [],
      silenceThreshold: -40,
      silences: heard.silences ?? [],
      beats: heard.beats ? { tempo: 120, confidence: 0.9, times: heard.beats } : null,
    },
  });
}

interface Clip {
  id: string;
  type: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  params: Record<string, unknown>;
  animations?: { volume?: { keys: Array<{ time: number; value: number }> } };
}
interface Track {
  id: string;
  name: string;
  elements: Clip[];
}

const tracksOf = (document: VideoProjectDocument) =>
  (
    document.project as {
      scenes: Array<{ tracks: { main: Track; overlay: Track[]; audio: Track[] } }>;
    }
  ).scenes[0].tracks;
const spans = (track: Track) =>
  track.elements.map((clip) => [clip.startTime / tick, (clip.startTime + clip.duration) / tick]);

/** A video of two clips, a.mp4 then b.mp4, four seconds each. */
const twoClips = () =>
  tools.editVideoProject(
    empty(),
    [
      { op: "add", item_id: "a.mp4" },
      { op: "add", item_id: "b.mp4" },
    ],
    loadMedia,
  );

describe("music under a video", () => {
  it("lays a longer sound to the picture's length, ducked under speech, faded out", async () => {
    sound("a.mp4", 4, { silences: [[0, 1]] });
    sound("b.mp4", 4, { silences: [[3, 4]] });
    sound("song.mp3", 10);
    const video = await edits.addMusic(
      await twoClips(),
      { op: "add_music", item_id: "song.mp3" },
      context,
    );
    const track = tracksOf(video).audio.at(-1)!;
    expect(track.name).toBe("Music");
    expect(spans(track)).toEqual([[0, 8]]);
    const [piece] = track.elements;
    expect(piece.trimStart).toBe(0);
    expect(piece.trimEnd).toBe(2 * tick);
    expect(piece.params.volume).toBe(music.DEFAULT_MUSIC_DB);
    const keys = piece.animations!.volume!.keys;
    expect(keys[0]).toMatchObject({ time: 0, value: -8 });
    expect(keys.at(-1)).toMatchObject({ time: 8 * tick, value: -60 });
    // Under the speech from 1s on, the music sits 12 dB lower.
    expect(keys.find((key) => key.time === tick)?.value).toBe(-20);
    expect(keys.every((key, i) => i === 0 || key.time > keys[i - 1].time)).toBe(true);
    expect(video.media.map((media) => media.itemId)).toContain("song.mp3");
  });

  it("leaves the level alone under speech when asked not to duck", async () => {
    sound("a.mp4", 4, { silences: [[0, 1]] });
    sound("song.mp3", 10);
    const video = await edits.addMusic(
      await twoClips(),
      { op: "add_music", item_id: "song.mp3", volume: -6, duck: false },
      context,
    );
    const keys = tracksOf(video).audio.at(-1)!.elements[0].animations!.volume!.keys;
    expect(keys.map((key) => [key.time / tick, key.value])).toEqual([
      [0, -6],
      [6, -6],
      [8, -60],
    ]);
  });

  it("loops a shorter sound on whole bars, piece after piece with no gap", async () => {
    sound("short.mp3", 3, { beats: beatsFrom(0, 0.25, 2.75) });
    const video = await edits.addMusic(
      await twoClips(),
      { op: "add_music", item_id: "short.mp3", duck: false },
      context,
    );
    const track = tracksOf(video).audio.at(-1)!;
    expect(spans(track)).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 8],
    ]);
    expect(track.elements.every((piece) => piece.trimStart === 0)).toBe(true);
    expect(track.elements[0].trimEnd).toBe(1 * tick);
  });

  it("starts loops after the first beat, so the intro plays once", () => {
    const pieces = music.musicPieces(10, 20, beatsFrom(0.2, 0.5, 9.7));
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toMatchObject({ start: 0, sourceStart: 0 });
    expect(pieces[0].sourceEnd).toBeCloseTo(8.2);
    expect(pieces[1].start).toBeCloseTo(8.2);
    expect(pieces[1].sourceStart).toBeCloseTo(0.2);
    expect(pieces[2].start + pieces[2].sourceEnd - pieces[2].sourceStart).toBeCloseTo(20);
  });

  it("joins speech close together into one dip", () => {
    expect(
      music.duckRanges(
        [
          [1, 2],
          [2.5, 3],
          [6, 7],
          [9, 9.1],
        ],
        8,
      ),
    ).toEqual([
      [1, 3],
      [6, 7],
    ]);
  });

  it("refuses a photo or video as music, and a video with nothing in it", async () => {
    await expect(
      edits.addMusic(await twoClips(), { op: "add_music", item_id: "a.mp4" }, context),
    ).rejects.toThrow("isn't a sound");
    await expect(
      edits.addMusic(empty(), { op: "add_music", item_id: "song.mp3" }, context),
    ).rejects.toThrow("This video is empty");
  });
});

describe("cutting to the beat", () => {
  /** Two clips over a ten-second song with a beat every half second from `first`. */
  async function withSong(
    first: number,
    before: Parameters<typeof tools.editVideoProject>[1] = [],
  ) {
    sound("song.mp3", 10, { beats: beatsFrom(first, 0.5, 9.9) });
    return tools.editVideoProject(
      await twoClips(),
      [...before, { op: "add", item_id: "song.mp3", track: "audio" }],
      loadMedia,
    );
  }

  it("moves each cut to the nearest beat the clip can reach", async () => {
    const video = await withSong(0.3);
    const cut = await edits.cutToBeats(video, { op: "cut_to_beats" }, context);
    const tracks = tracksOf(cut);
    expect(spans(tracks.main)).toEqual([
      [0, 3.8],
      [3.8, 7.8],
    ]);
    // Each clip keeps its first frame; the first lost the end it couldn't keep.
    expect(tracks.main.elements.map((clip) => clip.trimStart)).toEqual([0, 0]);
    expect(tracks.main.elements[0].trimEnd).toBe(Math.round(0.2 * tick));
    // The music stays where it was.
    expect(spans(tracks.audio.at(-1)!)).toEqual([[0, 10]]);
  });

  it("cuts every other beat when asked", async () => {
    const cut = await edits.cutToBeats(
      await withSong(0.3),
      { op: "cut_to_beats", every: 2 },
      context,
    );
    expect(spans(tracksOf(cut).main)).toEqual([
      [0, 3.3],
      [3.3, 7.3],
    ]);
  });

  it("lets a clip run on into source it had trimmed off", async () => {
    const video = await withSong(0.1, [{ op: "cut", ranges: [{ start: 3, end: 4 }] }]);
    const cut = await edits.cutToBeats(video, { op: "cut_to_beats" }, context);
    const tracks = tracksOf(cut);
    expect(spans(tracks.main)).toEqual([
      [0, 3.1],
      [3.1, 7.1],
    ]);
    expect(tracks.main.elements[0].trimEnd).toBe(Math.round(0.9 * tick));
  });

  it("moves titles with the clip they are over", async () => {
    const video = await withSong(0.3, [{ op: "text", text: "Hi", start: 5, end: 6 }]);
    const cut = await edits.cutToBeats(video, { op: "cut_to_beats" }, context);
    const title = tracksOf(cut).overlay.find((track) =>
      track.elements.some((clip) => clip.type === "text"),
    )!;
    expect(spans(title)).toEqual([[4.8, 5.8]]);
  });

  it("refuses with no music, and with music that has no beat", async () => {
    await expect(
      edits.cutToBeats(await twoClips(), { op: "cut_to_beats" }, context),
    ).rejects.toThrow("There's no music");
    sound("plain.mp3", 10);
    const video = await tools.editVideoProject(
      await twoClips(),
      [{ op: "add", item_id: "plain.mp3", track: "audio" }],
      loadMedia,
    );
    await expect(edits.cutToBeats(video, { op: "cut_to_beats" }, context)).rejects.toThrow(
      "No steady beat",
    );
  });
});
