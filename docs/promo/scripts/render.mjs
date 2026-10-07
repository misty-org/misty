import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dependency, browserOptions } from "./runtime.mjs";
import { scenes, DURATION, FPS } from "../timeline.ts";
const { chromium } = dependency("playwright");
const sharp = dependency("sharp");
const root = resolve(import.meta.dirname, "..");
const output = join(root, "output");
await mkdir(output, { recursive: true });
const mode = process.argv[2] || "storyboard";
const browser = await chromium.launch(browserOptions(chromium));
const errors = [];
async function createPage(scale = 1) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${process.env.PROMO_URL || "http://127.0.0.1:5290"}/?render=1`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => window.promoReady === true);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
  });
  return page;
}
const setTime = (page, time) => page.evaluate((frame) => window.renderFrame(frame), time * FPS);
function ffmpeg(args) {
  const child = spawn(
    process.env.FFMPEG || "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise((res, rej) => {
    child.on("error", rej);
    child.on("close", (code) => (code === 0 ? res() : rej(new Error(`FFmpeg exit ${code}`))));
  });
  return { child, done };
}
try {
  if (mode === "storyboard") {
    const page = await createPage();
    const cards = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      await setTime(page, s.still);
      const png = await page.screenshot({ type: "png" });
      await writeFile(join(output, `scene-${String(i + 1).padStart(2, "0")}-${s.id}.png`), png);
      const thumb = await sharp(png).resize(768, 432).toBuffer();
      const label = Buffer.from(
        `<svg width="768" height="48"><rect width="768" height="48" fill="#191919"/><text x="18" y="29" font-family="Arial" font-size="15" fill="#ddd">${String(s.start).padStart(2, "0")}–${s.end}s  /  ${s.id === "intro" ? "Introduction" : s.id === "close" ? "Close" : s.title}</text></svg>`,
      );
      const x = (i % 2) * 768,
        y = Math.floor(i / 2) * 480;
      cards.push({ input: thumb, left: x, top: y }, { input: label, left: x, top: y + 432 });
    }
    await sharp({ create: { width: 1536, height: 1920, channels: 3, background: "#080808" } })
      .composite(cards)
      .png()
      .toFile(join(output, "storyboard.png"));
    // Inspect transitions and action results, not only one representative frame per section.
    const qaTimes = [
      0, 2.5, 8, 12.8, 18.6, 24, 28, 37.9, 40.4, 44.2, 46.7, 53, 56.9, 59.3, 65, 68.8, 72.9, 75, 77,
      82.5, 84, 89.9,
    ];
    const qa = [];
    for (let i = 0; i < qaTimes.length; i++) {
      await setTime(page, qaTimes[i]);
      const img = await page.screenshot({ type: "png" });
      const thumb = await sharp(img).resize(480, 270).toBuffer();
      const x = (i % 4) * 480,
        y = Math.floor(i / 4) * 300;
      qa.push({ input: thumb, left: x, top: y });
      qa.push({
        input: Buffer.from(
          `<svg width="480" height="30"><rect width="480" height="30" fill="#222"/><text x="12" y="21" font-size="14" font-family="Arial" fill="#eee">${qaTimes[i]}s</text></svg>`,
        ),
        left: x,
        top: y + 270,
      });
    }
    await sharp({
      create: {
        width: 1920,
        height: Math.ceil(qaTimes.length / 4) * 300,
        channels: 3,
        background: "#080808",
      },
    })
      .composite(qa)
      .png()
      .toFile(join(output, "review-frames.png"));
    await writeFile(
      join(output, "storyboard.json"),
      JSON.stringify({ duration: DURATION, fps: FPS, scenes, errors }, null, 2),
    );
    console.log("Storyboard and action-review contact sheets saved.");
  } else {
    const rough = mode === "rough";
    const fps = rough ? 10 : FPS,
      scale = rough ? 0.5 : 1;
    const total = DURATION * fps;
    const workers = Number(process.env.RENDER_WORKERS || 3);
    const chunks = [];
    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        const start = Math.floor((total * worker) / workers),
          end = Math.floor((total * (worker + 1)) / workers);
        const page = await createPage(scale);
        const path = join(output, `${mode}-part-${worker}.mp4`);
        chunks[worker] = path;
        const { child, done } = ffmpeg([
          "-f",
          "image2pipe",
          "-framerate",
          String(fps),
          "-vcodec",
          "mjpeg",
          "-i",
          "pipe:0",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          rough ? "24" : "18",
          "-vf",
          "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
          "-color_range",
          "tv",
          "-colorspace",
          "bt709",
          "-color_primaries",
          "bt709",
          "-color_trc",
          "bt709",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "2",
          "-movflags",
          "+faststart",
          path,
        ]);
        for (let f = start; f < end; f++) {
          await setTime(page, f / fps);
          const jpg = await page.screenshot({ type: "jpeg", quality: 96 });
          if (!child.stdin.write(jpg)) await once(child.stdin, "drain");
          if ((f - start) % 150 === 0)
            console.log(`${mode} worker ${worker + 1}: ${f - start}/${end - start}`);
        }
        child.stdin.end();
        await done;
        await page.context().close();
        console.log(`${mode} worker ${worker + 1} complete`);
      }),
    );
    const list = join(output, `${mode}-concat.txt`);
    await writeFile(list, chunks.map((x) => `file '${x.replace(/'/g, "'\\''")}'`).join("\n"));
    const final = join(output, rough ? "misty-rough.mp4" : "misty-silent.mp4");
    await ffmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      final,
    ]).done;
    await writeFile(
      join(output, `${mode}-render.json`),
      JSON.stringify(
        {
          width: 1920 * scale,
          height: 1080 * scale,
          fps,
          duration: DURATION,
          frames: total,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(`Saved ${final}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
}
