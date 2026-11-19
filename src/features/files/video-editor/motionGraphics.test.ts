import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { replayMotionCommands, sanitizeMotionCommands } from "@opencut/motion/commands";
import { MOTION_PRESETS } from "@opencut/motion/presets";
import {
  checkMotionProps,
  mergeMotionProps,
  motionPropLabel,
  motionPropValues,
  readMotionProps,
} from "@opencut/motion/props";
import {
  checkMotionScript,
  loadMotionRuntime,
  runMotionFrame,
  setMotionWasm,
  testMotionScript,
} from "@opencut/motion/runtime";

beforeAll(async () => {
  setMotionWasm(createRequire(import.meta.url).resolve("@jitl/quickjs-wasmfile-release-sync/wasm"));
  await loadMotionRuntime();
});

const frame = (script: string, time = 1, props: Record<string, string | number> = {}) =>
  runMotionFrame({ script, props, time, duration: 4, width: 1920, height: 1080 });

const names = (script: string, time = 1) => {
  const result = frame(script, time);
  if (!result.ok) throw new Error(result.error);
  return result.commands.map((command) => command[0]);
};

describe("motion graphic scripts", () => {
  it("draws every starter graphic over its whole length", () => {
    for (const preset of MOTION_PRESETS) {
      const props = motionPropValues(preset.props);
      expect(
        testMotionScript({ script: preset.script, props, duration: 5, width: 1920, height: 1080 }),
        preset.id,
      ).toBeNull();
      expect(
        testMotionScript({ script: preset.script, props, duration: 5, width: 1080, height: 1920 }),
        preset.id,
      ).toBeNull();
      const shown = runMotionFrame({
        script: preset.script,
        props,
        time: preset.previewTime,
        duration: preset.previewDuration,
        width: 1920,
        height: 1080,
      });
      expect(shown.ok && shown.commands.length > 0, preset.id).toBe(true);
    }
  });

  it("records the canvas calls a script makes, gradients included", () => {
    const script = `function draw(ctx, t, props, { width, height }) {
      const glow = ctx.createLinearGradient(0, 0, width, 0);
      glow.addColorStop(0, props.accent);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.roundRect(10, 10, width / 2, height / 4, [8, 8, 0, 0]);
      ctx.fill();
      ctx.font = "700 64px Inter, sans-serif";
      ctx.fillText(props.title, 20, 20 + ctx.measureText(props.title).width * 0);
    }`;
    const result = frame(script, 1, { accent: "#ff0000", title: "Day one" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands).toEqual([
      ["linearGradient", 0, 0, 0, 1920, 0],
      ["colorStop", 0, 0, "#ff0000"],
      ["colorStop", 0, 1, "rgba(0, 0, 0, 0)"],
      ["fillStyle", 0],
      ["beginPath"],
      ["roundRect", 10, 10, 960, 270, [8, 8, 0, 0]],
      ["fill"],
      ["font", "700 64px Inter, sans-serif"],
      ["fillText", "Day one", 20, 20],
    ]);
  });

  it("draws a frame the same however often and in whatever order it is drawn", () => {
    const script = `let count = 0;
      function draw(ctx, t) {
        count++;
        ctx.fillRect(count, Math.random() * 100, t, 1);
      }`;
    const first = frame(script, 1.5);
    frame(script, 3);
    const again = frame(script, 1.5);
    expect(first).toEqual(again);
    expect(first.ok && first.commands[0]![1]).toBe(1);
    const other = frame(script, 2);
    expect(other.ok && first.ok && other.commands[0]![2] !== first.commands[0]![2]).toBe(true);
  });

  it("gives the script no clock, page, network or way to keep state on the globals", () => {
    const script = `function draw(ctx) {
      ctx.fillText([typeof Date, typeof fetch, typeof document, typeof window, typeof setTimeout].join(","), 0, 0);
      globalThis.kept = 1;
    }`;
    const result = frame(script);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/TypeError/);
    const seen = frame(`function draw(ctx) {
      ctx.fillText([typeof Date, typeof fetch, typeof document, typeof window, typeof setTimeout].join(","), 0, 0);
    }`);
    expect(seen.ok && seen.commands[0]).toEqual([
      "fillText",
      "undefined,undefined,undefined,undefined,undefined",
      0,
      0,
    ]);
  });

  it("points at the line a script broke on", () => {
    const broken = checkMotionScript("function draw(ctx) {\n  ctx.fillRect(0, 0, 1,\n}");
    expect(broken).toMatch(/^SyntaxError/);
    const thrown = frame(
      "function draw(ctx) {\n  const box = null;\n  ctx.fillRect(box.x, 0, 1, 1);\n}",
    );
    expect(thrown.ok).toBe(false);
    expect(!thrown.ok && thrown.error).toMatch(/TypeError: .*\(line 3\)/);
  });

  it("refuses a script without draw", () => {
    expect(checkMotionScript("const x = 1;")).toMatch(/must define function draw/);
  });

  it("stops a frame that runs too long or uses too much memory", () => {
    const spin = frame("function draw() { for (;;) {} }");
    expect(!spin.ok && spin.error).toMatch(/longer than 100 ms/);
    const hog = frame(
      "function draw() { const kept = []; for (;;) kept.push(new Array(100000).fill(0)); }",
    );
    expect(!hog.ok && hog.error).toMatch(/memory/);
    // The engine that ran out starts afresh and draws again.
    expect(frame("function draw(ctx) { ctx.fillRect(0, 0, 1, 1); }").ok).toBe(true);
  });

  it("refuses a frame that draws too much", () => {
    const result = frame(
      "function draw(ctx) { for (let i = 0; i < 30000; i++) ctx.fillRect(i, 0, 1, 1); }",
    );
    expect(!result.ok && result.error).toMatch(/at most 20000 drawing calls/);
  });

  it("names what a motion graphic can't use", () => {
    const shadow = frame("function draw(ctx) { ctx.shadowBlur = 8; }");
    expect(!shadow.ok && shadow.error).toMatch(/ctx.shadowBlur isn't available/);
    const image = frame("function draw(ctx) { ctx.drawImage(null, 0, 0); }");
    expect(!image.ok && image.error).toMatch(/ctx.drawImage isn't available/);
  });

  it("measures text for layout", () => {
    const result = frame(
      'function draw(ctx) { ctx.font = "40px sans-serif"; ctx.fillRect(0, 0, ctx.measureText("Hello").width, 1); }',
    );
    expect(result.ok && (result.commands[1]![3] as number) > 0).toBe(true);
  });

  it("keeps a script's own save and restore balanced", () => {
    expect(
      names("function draw(ctx) { ctx.restore(); ctx.save(); ctx.save(); ctx.restore(); }"),
    ).toEqual(["save", "save", "restore"]);
  });
});

describe("checking what a script drew", () => {
  it("leaves out calls with bad values and keeps the rest", () => {
    const result = sanitizeMotionCommands([
      ["fillRect", 0, 0, null, 1],
      ["fillRect", 0, 0, 1e9, 1],
      ["fillStyle", "url(https://example.test/x.png)"],
      ["fillStyle", "#ffffff"],
      ["fillStyle", 3],
      ["font", "12px <b>"],
      ["font", "600 40px Inter, sans-serif"],
      ["font", "9000px Inter"],
      ["arc", 0, 0, -1, 0, 1, false],
      ["lineWidth", 0],
      ["globalAlpha", 2],
      ["colorStop", 0, 0.5, "red"],
      ["fillRect", 1, 2, 3, 4],
    ]);
    expect(result).toEqual({
      ok: true,
      commands: [
        ["fillStyle", "#ffffff"],
        ["font", "600 40px Inter, sans-serif"],
        ["fillRect", 1, 2, 3, 4],
      ],
    });
  });

  it("refuses calls the stand-in context doesn't offer, and a list that isn't one", () => {
    expect(sanitizeMotionCommands([["drawImage", 0, 0]]).ok).toBe(false);
    expect(sanitizeMotionCommands({ length: 1 }).ok).toBe(false);
    expect(sanitizeMotionCommands([[1, 2]]).ok).toBe(false);
  });

  it("replays checked calls and leaves the canvas as it found it", () => {
    const calls: string[] = [];
    const record = new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "roundRect" || typeof key === "symbol"
            ? undefined
            : (...args: unknown[]) => {
                calls.push(`${String(key)}(${args.join(",")})`);
                return {
                  addColorStop: (offset: number, color: string) =>
                    calls.push(`stop(${offset},${color})`),
                };
              },
        set: (_target, key, value) => {
          calls.push(`${String(key)}=${typeof value === "object" ? "gradient" : value}`);
          return true;
        },
      },
    );
    const checked = sanitizeMotionCommands([
      ["save"],
      ["linearGradient", 0, 0, 0, 10, 0],
      ["colorStop", 0, 1, "#000000"],
      ["fillStyle", 0],
      ["roundRect", 0, 0, 10, 10, 4],
      ["save"],
    ]);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    replayMotionCommands(record as unknown as CanvasRenderingContext2D, checked.commands);
    expect(calls).toEqual([
      "save()",
      "save()",
      "createLinearGradient(0,0,10,0)",
      "stop(1,#000000)",
      "fillStyle=gradient",
      "rect(0,0,10,10)",
      "save()",
      "restore()",
      "restore()",
      "restore()",
    ]);
  });
});

describe("motion graphic props", () => {
  it("checks declarations and keeps numbers in their range", () => {
    expect(
      checkMotionProps({
        title: { type: "text", value: "Day one" },
        accent: { type: "color", value: "#FA0" },
        count: { type: "number", value: 500, min: 0, max: 100 },
      }),
    ).toEqual({
      title: { type: "text", value: "Day one" },
      accent: { type: "color", value: "#ffaa00" },
      count: { type: "number", value: 100, min: 0, max: 100 },
    });
    expect(() => checkMotionProps({ accent: { type: "color", value: "red" } })).toThrow(/#rrggbb/);
    expect(() => checkMotionProps({ "bad name": { type: "text", value: "" } })).toThrow(/name/);
    expect(() => checkMotionProps({ x: { type: "image", value: "" } })).toThrow(
      /text, color or number/,
    );
  });

  it("sets values, infers new props and removes ones set to null", () => {
    const base = checkMotionProps({
      title: { type: "text", value: "Day one" },
      size: { type: "number", value: 100, min: 40, max: 200 },
    });
    expect(
      mergeMotionProps(base, {
        title: "Day two",
        size: 900,
        accent: "#00ff00",
        count: 3,
        note: "hi",
      }),
    ).toEqual({
      title: { type: "text", value: "Day two" },
      size: { type: "number", value: 200, min: 40, max: 200 },
      accent: { type: "color", value: "#00ff00" },
      count: { type: "number", value: 3 },
      note: { type: "text", value: "hi" },
    });
    expect(mergeMotionProps(base, { size: null })).toEqual({ title: base.title });
    expect(() => mergeMotionProps(base, { title: 4 })).toThrow(/string/);
  });

  it("reads stored props leniently and labels them in words", () => {
    expect(
      readMotionProps(
        '{"title":{"type":"text","value":"A"},"broken":{"type":"color","value":"nope"}}',
      ),
    ).toEqual({ title: { type: "text", value: "A" } });
    expect(readMotionProps("not json")).toEqual({});
    expect(motionPropLabel("accentColor", { type: "color", value: "#000000" })).toBe(
      "Accent color",
    );
    expect(motionPropLabel("done_label", { type: "text", value: "" })).toBe("Done label");
    expect(motionPropLabel("size", { type: "number", value: 1, label: "Title size" })).toBe(
      "Title size",
    );
  });
});
