import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as ToolsModule from "./index";
import type { VideoProjectDocument } from "../projectDocumentTypes";

vi.mock("@opencut/media/processing", () => ({
  processMediaAssets: vi.fn(async ({ files }: { files: File[] }) =>
    files.map((file) =>
      file.name.endsWith(".mp3")
        ? { name: file.name, type: "audio", duration: 10, file }
        : { name: file.name, type: "video", duration: 4, width: 1280, height: 720, file },
    ),
  ),
}));

const require = createRequire(import.meta.url);
let tools: typeof ToolsModule;
let tick: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  tools = await import("./index");
  tick = (await import("@opencut/wasm")).TICKS_PER_SECOND;
});

const loadMedia = async (itemId: string) => new File(["x"], itemId);
const empty = (): VideoProjectDocument => ({
  kind: "misty.video",
  version: 1,
  project: null,
  media: [],
});

/** A video of two clips, a.mp4 then b.mp4, four seconds each. */
async function twoClips() {
  return tools.editVideoProject(
    empty(),
    [
      { op: "add", item_id: "a.mp4" },
      { op: "add", item_id: "b.mp4" },
    ],
    loadMedia,
  );
}

const main = (document: VideoProjectDocument) =>
  tools.describeVideoProject(document).tracks!.find((track) => track.type === "main")!.elements;

describe("agents edit a video project as data", () => {
  it("makes a project for an empty video and lays media end to end", async () => {
    const video = await twoClips();
    expect(main(video).map((clip) => [clip.item_id, clip.start, clip.end])).toEqual([
      ["a.mp4", 0, 4],
      ["b.mp4", 4, 8],
    ]);
    expect(tools.describeVideoProject(video).duration).toBe(8);
    expect(video.media.map((media) => media.itemId)).toEqual(["a.mp4", "b.mp4"]);
  });

  it("cuts a stretch out of every track and closes the gap", async () => {
    const video = await twoClips();
    const cut = await tools.editVideoProject(
      video,
      [{ op: "cut", ranges: [{ start: 3, end: 5 }] }],
      loadMedia,
    );
    expect(main(cut).map((clip) => [clip.item_id, clip.start, clip.end])).toEqual([
      ["a.mp4", 0, 3],
      ["b.mp4", 3, 6],
    ]);
    // The second clip now starts a second into its source.
    const project = cut.project as {
      scenes: Array<{ tracks: { main: { elements: Array<{ trimStart: number }> } } }>;
    };
    expect(project.scenes[0].tracks.main.elements[1].trimStart).toBe(tick);
    expect(video).not.toBe(cut);
    expect(main(video)).toHaveLength(2);
  });

  it("splits, deletes with the gap closed, and reorders the main track", async () => {
    const video = await twoClips();
    const split = await tools.editVideoProject(video, [{ op: "split", at: 2 }], loadMedia);
    expect(main(split).map((clip) => [clip.start, clip.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 8],
    ]);
    const [first, , last] = main(split);
    const deleted = await tools.editVideoProject(
      split,
      [{ op: "delete", element_ids: [first.id] }],
      loadMedia,
    );
    expect(main(deleted).map((clip) => [clip.start, clip.end])).toEqual([
      [0, 2],
      [2, 6],
    ]);
    const ordered = await tools.editVideoProject(
      deleted,
      [{ op: "order", element_ids: [last.id] }],
      loadMedia,
    );
    expect(main(ordered).map((clip) => [clip.id, clip.start])).toEqual([
      [last.id, 0],
      [main(deleted)[0].id, 4],
    ]);
  });

  it("sets a clip's look and speed within what the editor allows", async () => {
    const video = await twoClips();
    const [a] = main(video);
    const set = await tools.editVideoProject(
      video,
      [
        {
          op: "set",
          element_ids: [a.id],
          params: { "adjust.exposure": 9, "transition.in": "fade" },
          speed: 2,
        },
      ],
      loadMedia,
    );
    const clip = main(set)[0];
    expect(clip.params).toMatchObject({ "adjust.exposure": 2, "transition.in": "fade" });
    expect([clip.start, clip.end]).toEqual([0, 2]);
    expect(main(set)[1].start).toBe(2);
    await expect(
      tools.editVideoProject(
        video,
        [{ op: "set", element_ids: [a.id], params: { "transition.in": "spin" } }],
        loadMedia,
      ),
    ).rejects.toThrow("transition.in takes one of");
    await expect(
      tools.editVideoProject(
        video,
        [{ op: "set", element_ids: [a.id], params: { fontSize: 3 } }],
        loadMedia,
      ),
    ).rejects.toThrow("A video clip has no fontSize.");
    await expect(
      tools.editVideoProject(video, [{ op: "delete", element_ids: ["nope"] }], loadMedia),
    ).rejects.toThrow("There is no clip nope");
  });

  it("adds text and sound, and changes the frame", async () => {
    const video = await twoClips();
    const done = await tools.editVideoProject(
      video,
      [
        { op: "text", text: "Day one", start: 0, end: 2, position: "bottom" },
        { op: "text", text: "Later", start: 5, end: 6 },
        { op: "add", item_id: "song.mp3" },
        { op: "frame", aspect: "9:16" },
      ],
      loadMedia,
    );
    const read = tools.describeVideoProject(done);
    const text = read.tracks!.filter((track) => track.type === "text");
    expect(text).toHaveLength(1);
    expect(text[0].elements.map((clip) => [clip.start, clip.end, clip.params?.content])).toEqual([
      [0, 2, "Day one"],
      [5, 6, "Later"],
    ]);
    expect(read.tracks!.filter((track) => track.type === "audio")[0].elements[0].item_id).toBe(
      "song.mp3",
    );
    expect(read.frame).toEqual({ width: 1080, height: 1920 });
  });

  it("moves the project's clock on, so its change is the newest everywhere", async () => {
    const video = await twoClips();
    const before = (video.project as { metadata: { updatedAt: string } }).metadata.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const after = await tools.editVideoProject(video, [{ op: "frame", aspect: "1:1" }], loadMedia);
    expect(
      Date.parse((after.project as { metadata: { updatedAt: string } }).metadata.updatedAt),
    ).toBeGreaterThan(Date.parse(before));
  });

  it("lays captions on a track of their own, one clip per phrase", async () => {
    const video = await twoClips();
    const captioned = await tools.editVideoProject(
      video,
      [
        {
          op: "captions",
          phrases: [
            { text: "hello there", start: 0.2, end: 1 },
            { text: "bye", start: 2, end: 2.5 },
          ],
        },
      ],
      loadMedia,
    );
    const track = tools
      .describeVideoProject(captioned)
      .tracks!.find((each) => each.type === "text")!;
    expect(track.elements.map((clip) => [clip.start, clip.end, clip.params?.content])).toEqual([
      [0.2, 1, "hello there"],
      [2, 2.5, "bye"],
    ]);
  });
});
