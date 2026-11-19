import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as ToolsModule from "./index";
import type * as ClipEditsModule from "./clipEdits";
import type { VideoProjectDocument } from "../projectDocumentTypes";

vi.mock("@opencut/media/processing", () => ({
  processMediaAssets: vi.fn(async ({ files }: { files: File[] }) =>
    files.map((file) => {
      if (file.name.endsWith(".mp3")) return { name: file.name, type: "audio", duration: 10, file };
      if (file.name.endsWith(".jpg"))
        return { name: file.name, type: "image", width: 800, height: 600, file };
      const duration = file.name.startsWith("short") ? 2 : 4;
      return { name: file.name, type: "video", duration, width: 1280, height: 720, file };
    }),
  ),
}));

const require = createRequire(import.meta.url);
let tools: typeof ToolsModule;
let clips: typeof ClipEditsModule;
let tick: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  tools = await import("./index");
  clips = await import("./clipEdits");
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

/** A video of two clips, a.mp4 then b.mp4, four seconds each. */
async function twoClips(more: Parameters<typeof tools.editVideoProject>[1] = []) {
  return tools.editVideoProject(
    empty(),
    [{ op: "add", item_id: "a.mp4" }, { op: "add", item_id: "b.mp4" }, ...more],
    loadMedia,
  );
}

const read = (document: VideoProjectDocument) => tools.describeVideoProject(document);
const main = (document: VideoProjectDocument) =>
  read(document).tracks!.find((track) => track.type === "main")!.elements;

interface RawClip {
  id: string;
  type: string;
  mediaId?: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  sourceDuration?: number;
  retime?: { rate: number };
  params: Record<string, unknown>;
}
/** The shown scene's tracks as OpenCut keeps them. */
const raw = (document: VideoProjectDocument) =>
  (
    document.project as {
      scenes: Array<{
        tracks: { main: { elements: RawClip[] }; audio: Array<{ elements: RawClip[] }> };
      }>;
    }
  ).scenes[0].tracks;

describe("replacing a clip's media", () => {
  it("keeps the clip's place, timing and look, and lists the new media", async () => {
    const video = await twoClips();
    const [a] = main(video);
    const looked = await tools.editVideoProject(
      video,
      [{ op: "set", element_ids: [a.id], params: { "adjust.exposure": 1 } }],
      loadMedia,
    );
    const swapped = await clips.replaceSource(
      looked,
      { op: "replace_source", element_id: a.id, item_id: "a-clean.mp4" },
      context,
    );
    const clip = main(swapped)[0];
    expect([clip.id, clip.item_id, clip.start, clip.end]).toEqual([a.id, "a-clean.mp4", 0, 4]);
    expect(clip.params).toMatchObject({ "adjust.exposure": 1 });
    expect(main(swapped)[1].start).toBe(4);
    expect(swapped.media.map((media) => media.itemId)).toEqual(["a.mp4", "b.mp4", "a-clean.mp4"]);
    // The document given is left as it was.
    expect(main(looked)[0].item_id).toBe("a.mp4");
  });

  it("shortens a clip to a shorter file, from where it starts in it, and closes the gap", async () => {
    // The first second of a is cut, so a plays its media from 1s to 4s.
    const video = await twoClips([{ op: "cut", ranges: [{ start: 0, end: 1 }] }]);
    const [a, b] = main(video);
    const swapped = await clips.replaceSource(
      video,
      { op: "replace_source", element_id: a.id, item_id: "short.mp4" },
      context,
    );
    expect(main(swapped).map((clip) => [clip.id, clip.start, clip.end])).toEqual([
      [a.id, 0, 1],
      [b.id, 1, 5],
    ]);
    const [first] = raw(swapped).main.elements;
    expect(first.trimStart).toBe(tick);
    expect(first.trimEnd).toBe(0);
    expect(first.sourceDuration).toBe(2 * tick);
  });

  it("refuses a kind of media the clip can't take, and swaps a sound for a sound", async () => {
    const video = await twoClips([{ op: "add", item_id: "song.mp3" }]);
    const [a] = main(video);
    await expect(
      clips.replaceSource(
        video,
        { op: "replace_source", element_id: a.id, item_id: "voice.mp3" },
        context,
      ),
    ).rejects.toThrow("A video clip can't take a sound");
    await expect(
      clips.replaceSource(
        video,
        { op: "replace_source", element_id: a.id, item_id: "still.jpg" },
        context,
      ),
    ).rejects.toThrow("A video clip takes a video, not a photo.");
    const song = read(video).tracks!.find((track) => track.type === "audio")!.elements[0];
    const swapped = await clips.replaceSource(
      video,
      { op: "replace_source", element_id: song.id, item_id: "voice.mp3" },
      context,
    );
    const sound = read(swapped).tracks!.find((track) => track.type === "audio")!.elements[0];
    expect([sound.item_id, sound.start, sound.end]).toEqual(["voice.mp3", 0, 10]);
    await expect(
      clips.replaceSource(
        video,
        { op: "replace_source", element_id: "nope", item_id: "voice.mp3" },
        context,
      ),
    ).rejects.toThrow("There is no clip nope");
  });
});

describe("speed ramps", () => {
  it("eases a clip's speed across pieces that play its source end to end", async () => {
    const video = await twoClips();
    const [a, b] = main(video);
    const ramped = await clips.speedRamp(
      video,
      { op: "speed_ramp", element_id: a.id, from: 1, to: 2, steps: 4 },
      context,
    );
    const pieces = raw(ramped).main.elements.slice(0, 4);
    expect(pieces[0].id).toBe(a.id);
    expect(pieces[0].retime?.rate).toBe(1);
    expect(pieces[3].retime?.rate).toBe(2);
    const rates = pieces.map((piece) => piece.retime!.rate);
    expect([...rates].sort((x, y) => x - y)).toEqual(rates);
    // Each piece starts in the source where the last one ended, and they end with the clip.
    for (let index = 1; index < pieces.length; index++) {
      const before = pieces[index - 1];
      expect(pieces[index].startTime).toBe(before.startTime + before.duration);
      expect(
        Math.abs(
          pieces[index].trimStart - (before.trimStart + before.duration * before.retime!.rate),
        ),
      ).toBeLessThanOrEqual(4);
    }
    expect(pieces[3].trimEnd).toBe(0);
    // Faster pieces make the clip shorter, and b follows straight after.
    const end = pieces[3].startTime + pieces[3].duration;
    expect(end).toBeLessThan(4 * tick);
    expect(end).toBeGreaterThan(2 * tick);
    const after = main(ramped).find((clip) => clip.id === b.id)!;
    expect(after.start).toBeCloseTo(end / tick, 2);
  });

  it("ramps only the stretch asked for, keeping the clip either side of it", async () => {
    const video = await twoClips();
    const [a] = main(video);
    const ramped = await clips.speedRamp(
      video,
      { op: "speed_ramp", element_id: a.id, from: 1, to: 0.5, start: 1, end: 3 },
      context,
    );
    const elements = raw(ramped).main.elements;
    // Before, eight pieces, after, then b.
    expect(elements).toHaveLength(1 + clips.DEFAULT_RAMP_STEPS + 1 + 1);
    expect([elements[0].startTime, elements[0].duration]).toEqual([0, tick]);
    expect(elements[0].retime?.rate ?? 1).toBe(1);
    const tail = elements[clips.DEFAULT_RAMP_STEPS + 1];
    expect(tail.retime?.rate ?? 1).toBe(1);
    expect(tail.duration).toBe(tick);
    // Slowing down makes the two seconds longer.
    expect(tail.startTime).toBeGreaterThan(3 * tick);
  });

  it("refuses what a ramp can't do", async () => {
    const video = await tools.editVideoProject(
      empty(),
      [
        { op: "add", item_id: "a.mp4" },
        { op: "add", item_id: "still.jpg" },
      ],
      loadMedia,
    );
    const [a, still] = main(video);
    await expect(
      clips.speedRamp(video, { op: "speed_ramp", element_id: still.id, from: 1, to: 2 }, context),
    ).rejects.toThrow("Only video and sound clips have a speed");
    await expect(
      clips.speedRamp(
        video,
        { op: "speed_ramp", element_id: a.id, from: 1, to: 2, steps: 30 },
        context,
      ),
    ).rejects.toThrow("steps is a whole number from 2 to 24.");
    await expect(
      clips.speedRamp(video, { op: "speed_ramp", element_id: a.id, from: 0, to: 2 }, context),
    ).rejects.toThrow("from and to are speeds above 0");
    expect(clips.rampRates(1, 3, 3)).toEqual([1, 2, 3]);
    // Speeds stay within what the editor plays.
    expect(clips.rampRates(1, 9, 2)).toEqual([1, 5]);
  });
});

describe("transitions between two clips", () => {
  it("sets the first clip's way out and the second's way in to match", async () => {
    const video = await twoClips();
    const [a, b] = main(video);
    const done = await clips.transition(
      video,
      { op: "transition", element_ids: [a.id, b.id], kind: "dip-black", seconds: 0.8 },
      context,
    );
    const [first, second] = main(done);
    expect(first.params).toMatchObject({
      "transition.out": "dip-black",
      "transition.outDuration": 0.8,
    });
    expect(second.params).toMatchObject({
      "transition.in": "dip-black",
      "transition.inDuration": 0.8,
    });
    const wiped = await clips.transition(
      video,
      { op: "transition", element_ids: [a.id, b.id], kind: "wipe-left", seconds: 30 },
      context,
    );
    expect(main(wiped)[0].params).toMatchObject({ "transition.outDuration": 4 });
  });

  it("refuses a kind there is no such transition of, and one clip twice", async () => {
    const video = await twoClips();
    const [a, b] = main(video);
    await expect(
      clips.transition(
        video,
        { op: "transition", element_ids: [a.id, b.id], kind: "spin" },
        context,
      ),
    ).rejects.toThrow("kind is one of");
    await expect(
      clips.transition(
        video,
        { op: "transition", element_ids: [a.id, a.id], kind: "fade" },
        context,
      ),
    ).rejects.toThrow("element_ids of two clips");
  });
});
