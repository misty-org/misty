import { describe, expect, it } from "vitest";
import {
  mapSketch,
  MAX_SKETCH_ELEMENTS,
  parseSketch,
  sketchSkeleton,
  withoutSketch,
} from "./companionSketch";
import { boardCardBox } from "./pointLayout";

const fence = "```";
const reply = [
  "a hash map remembers what you've seen.",
  fence + "misty-sketch",
  '{"surface":"board","title":"one pass"}',
  '{"id":"a","type":"rectangle","x":0,"y":0,"width":180,"height":60,"label":"num = 7"}',
  '{"id":"b","type":"rectangle","x":300,"y":0,"width":180,"height":60,"label":"seen"}',
  '{"id":"c","type":"arrow","from":"a","to":"b","label":"9 - 7?"}',
  fence,
  "that's the whole trick.",
].join("\n");

describe("companion sketches", () => {
  it("reads a finished drawing and keeps it out of what is said", () => {
    const sketch = parseSketch(reply)!;
    expect(sketch.header).toEqual({ surface: "board", title: "one pass" });
    expect(sketch.elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(sketch.done).toBe(true);
    expect(withoutSketch(reply)).toBe(
      "a hash map remembers what you've seen.\n\nthat's the whole trick.",
    );
  });

  it("draws what has arrived while the reply streams, skipping a cut-off line", () => {
    const partial = reply.slice(0, reply.indexOf('{"id":"b"') + 20);
    const sketch = parseSketch(partial)!;
    expect(sketch.done).toBe(false);
    expect(sketch.elements.map((e) => e.id)).toEqual(["a"]);
    expect(withoutSketch(partial)).toBe("a hash map remembers what you've seen.");
  });

  it("drops bad lines and caps the drawing", () => {
    const lines = Array.from(
      { length: MAX_SKETCH_ELEMENTS + 10 },
      (_, i) => `{"id":"r${i}","type":"rectangle","x":${i},"y":0,"width":10,"height":10}`,
    );
    const sketch = parseSketch(
      [
        fence + "misty-sketch",
        '{"surface":"board"}',
        "not json",
        '{"id":"x","type":"star"}',
        ...lines,
        fence,
      ].join("\n"),
    )!;
    expect(sketch.elements).toHaveLength(MAX_SKETCH_ELEMENTS);
    expect(sketch.elements[0].id).toBe("r0");
    expect(parseSketch(fence + "misty-sketch\n" + '{"surface":"wall"}\n' + fence)).toBeUndefined();
  });

  it("binds arrows to what they join and keeps free arrows on their points", () => {
    const skeleton = sketchSkeleton(parseSketch(reply)!.elements);
    expect(skeleton[2]).toMatchObject({
      type: "arrow",
      start: { id: "a" },
      end: { id: "b" },
      label: { text: "9 - 7?" },
    });
    const [free] = sketchSkeleton(
      [
        {
          id: "m",
          type: "arrow",
          points: [
            [700, 120],
            [560, 230],
          ],
        },
      ],
      "#ffffff",
    );
    expect(free).toMatchObject({
      x: 700,
      y: 120,
      points: [
        [0, 0],
        [-140, 110],
      ],
      strokeColor: "#ffffff",
    });
  });

  it("moves screen marks from screenshot pixels to the display", () => {
    const [mark] = mapSketch([{ id: "m", type: "ellipse", x: 100, y: 50, width: 40, height: 20 }], {
      scaleX: 2,
      scaleY: 2,
      dx: -1920,
      dy: 0,
    });
    expect(mark).toMatchObject({ x: -1720, y: 100, width: 80, height: 40 });
  });

  it("places the whiteboard beside the cursor, on the side with room", () => {
    expect(boardCardBox({ x: 200, y: 400 }, 1440, 900)).toEqual({
      x: 248,
      y: 260,
      width: 380,
      height: 280,
    });
    expect(boardCardBox({ x: 1400, y: 20 }, 1440, 900)).toMatchObject({ x: 972, y: 16 });
  });
});
