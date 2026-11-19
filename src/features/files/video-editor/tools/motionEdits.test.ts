import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as ToolsModule from "./index";
import type * as MotionEditsModule from "./motionEdits";
import type * as ProjectModelModule from "./projectModel";
import type { VideoProjectDocument } from "../projectDocumentTypes";
import type { GraphicElement } from "@opencut/timeline";

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
let tools: typeof ToolsModule;
let motion: typeof MotionEditsModule;
let model: typeof ProjectModelModule;
let tick: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  const { setMotionWasm } = await import("@opencut/motion/runtime");
  setMotionWasm(require.resolve("@jitl/quickjs-wasmfile-release-sync/wasm"));
  tools = await import("./index");
  motion = await import("./motionEdits");
  model = await import("./projectModel");
  tick = (await import("@opencut/wasm")).TICKS_PER_SECOND;
});

const context = { loadMedia: async (itemId: string) => new File(["x"], itemId) };

async function oneClip(): Promise<VideoProjectDocument> {
  return tools.editVideoProject(
    { kind: "misty.video", version: 1, project: null, media: [] },
    [{ op: "add", item_id: "a.mp4" }],
    context.loadMedia,
  );
}

function graphics(document: VideoProjectDocument): GraphicElement[] {
  return model
    .sceneOf(model.projectOf(document))
    .tracks.overlay.filter((track) => track.type === "graphic")
    .flatMap((track) => track.elements as GraphicElement[]);
}

const SCRIPT = `function draw(ctx, t, props, { width, height }) {
  ctx.fillStyle = props.color;
  ctx.fillRect(0, height - 40, width * (t / 4), 40);
}`;

describe("agents add motion graphics", () => {
  it("adds a preset on a graphic track, with its props changed", async () => {
    const video = await motion.addMotionGraphic(
      await oneClip(),
      { op: "graphic", preset: "lower_third", props: { name: "Sam Lee" }, start: 0.5, end: 3.5 },
      context,
    );
    const [graphic] = graphics(video);
    expect(graphic).toMatchObject({
      type: "graphic",
      definitionId: "motion",
      name: "Lower third",
      startTime: Math.round(0.5 * tick),
      duration: Math.round(3 * tick),
    });
    expect(motion.describeMotionGraphic(graphic!)?.props.name).toEqual({
      type: "text",
      value: "Sam Lee",
    });
    expect(motion.describeMotionGraphic(graphic!)?.script).toContain("function draw");
  });

  it("adds an agent's own script with its props, and a second one beside it on the same track", async () => {
    const first = await motion.addMotionGraphic(
      await oneClip(),
      { op: "graphic", script: SCRIPT, props: { color: "#ff0000" }, start: 0, end: 1 },
      context,
    );
    const both = await motion.addMotionGraphic(
      first,
      {
        op: "graphic",
        script: SCRIPT,
        props: { color: { type: "color", value: "#00ff00", label: "Bar" } },
        start: 1,
        end: 2,
        position: { x: 0, y: -100 },
      },
      context,
    );
    const [one, two] = graphics(both);
    expect(motion.describeMotionGraphic(one!)?.props.color).toEqual({
      type: "color",
      value: "#ff0000",
    });
    expect(two!.params["transform.positionY"]).toBe(-100);
  });

  it("refuses a script that doesn't compile, defines no draw, throws or is too long", async () => {
    const video = await oneClip();
    const add = (script: string) =>
      motion.addMotionGraphic(video, { op: "graphic", script, start: 0, end: 2 }, context);
    await expect(add("function draw(ctx) { ctx.fillRect(0, 0, 1, }")).rejects.toThrow(
      /SyntaxError/,
    );
    await expect(add("const nothing = 1;")).rejects.toThrow(/must define function draw/);
    await expect(
      add("function draw(ctx, t) { if (t > 1) throw new Error('late'); }"),
    ).rejects.toThrow(/At 1\.\d+ s: Error: late/);
    await expect(add(`// ${"x".repeat(20_001)}\nfunction draw() {}`)).rejects.toThrow(
      /at most 20000/,
    );
    await expect(
      motion.addMotionGraphic(
        video,
        { op: "graphic", preset: "fireworks", start: 0, end: 1 },
        context,
      ),
    ).rejects.toThrow(/presets are title, lower_third, counter, progress_bar, subscribe/);
  });

  it("changes a graphic's props and script, and only a motion graphic's", async () => {
    const video = await motion.addMotionGraphic(
      await oneClip(),
      { op: "graphic", preset: "counter", start: 0, end: 4 },
      context,
    );
    const [graphic] = graphics(video);
    const changed = await motion.setMotionGraphic(
      video,
      { op: "set_graphic", element_id: graphic!.id, props: { value: 250, suffix: null } },
      context,
    );
    const props = motion.describeMotionGraphic(graphics(changed)[0]!)!.props;
    expect(props.value?.value).toBe(250);
    expect(props.suffix).toBeUndefined();

    const rewritten = await motion.setMotionGraphic(
      changed,
      { op: "set_graphic", element_id: graphic!.id, script: SCRIPT, props: { color: "#123456" } },
      context,
    );
    expect(motion.describeMotionGraphic(graphics(rewritten)[0]!)!.script).toBe(SCRIPT);

    const clipId = tools.describeVideoProject(video).tracks!.find((track) => track.type === "main")!
      .elements[0]!.id;
    await expect(
      motion.setMotionGraphic(video, { op: "set_graphic", element_id: clipId, props: {} }, context),
    ).rejects.toThrow(/isn't a motion graphic/);
  });
});
