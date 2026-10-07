// Renders the film from the preview server.
//   node scripts/render.mjs storyboard   stills, contact sheet, review sheet, cues.json
//   node scripts/render.mjs rough        960×540, 10 fps silent cut
//   node scripts/render.mjs final        1920×1080, 30 fps silent master
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { browserPath, output, PROMO_URL } from "./env.mjs";

const mode = process.argv[2] ?? "storyboard";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath(), args: ["--font-render-hinting=none"] });
const errors = [];

async function openFilm() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "warning" && message.text().startsWith("Film target") && errors.push(message.text()));
  await page.goto(`${PROMO_URL}/?render=1`, { waitUntil: "load" });
  // A first run can trigger Vite's dependency optimizer, which reloads once.
  for (let settled = 0; settled < 2; ) {
    await page.waitForFunction(() => window.promoReady === true, null, { timeout: 120_000 });
    const url = page.url();
    await page.waitForTimeout(2500);
    settled = (await page.evaluate(() => window.promoReady === true).catch(() => false)) && page.url() === url ? 2 : 0;
  }
  return page;
}
const seek = (page, frame) => page.evaluate((f) => window.renderFrame(f), frame);

function ffmpeg(args) {
  const child = spawn(process.env.FFMPEG ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  return { child, done };
}

const label = (text, width, height = 40, size = 17) =>
  Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#161616"/><text x="16" y="${height / 2 + size / 3}" font-family="Helvetica" font-size="${size}" fill="#e6e6e6">${text}</text></svg>`,
  );

async function sheet(name, shots, columns, thumbWidth) {
  const thumbHeight = Math.round((thumbWidth * 9) / 16);
  const rows = Math.ceil(shots.length / columns);
  const cell = thumbHeight + 40;
  const parts = [];
  for (const [index, shot] of shots.entries()) {
    const left = (index % columns) * (thumbWidth + 8);
    const top = Math.floor(index / columns) * (cell + 8);
    parts.push({ input: await sharp(shot.png).resize(thumbWidth, thumbHeight).toBuffer(), left, top });
    parts.push({ input: label(shot.caption, thumbWidth), left, top: top + thumbHeight });
  }
  await sharp({ create: { width: columns * (thumbWidth + 8) - 8, height: rows * (cell + 8) - 8, channels: 3, background: "#050505" } })
    .composite(parts)
    .png()
    .toFile(join(output, name));
}

try {
  if (mode === "storyboard") {
    const page = await openFilm();
    const { scenes, cues, missing } = await page.evaluate(async () => {
      const { scenes } = await import("/src/film/time.ts");
      return { scenes, cues: window.promoCues, missing: window.promoMissing };
    });
    errors.push(...missing.map((m) => `Unmeasured target: ${m}`));
    await writeFile(join(output, "cues.json"), JSON.stringify(cues, null, 2));
    const stills = [];
    for (const [index, scene] of scenes.entries()) {
      await seek(page, Math.round(scene.still * 30));
      const png = await page.screenshot({ type: "png" });
      await writeFile(join(output, `storyboard-${String(index + 1).padStart(2, "0")}-${scene.id}.png`), png);
      stills.push({ png, caption: `${scene.start}–${scene.end}s · ${scene.name}` });
    }
    await sheet("storyboard.png", stills, 2, 940);
    const times = (process.env.REVIEW_TIMES ?? "").split(",").filter(Boolean).map(Number);
    const review = [];
    for (const time of times.length ? times : [2, 4.6, 8.9, 11.4, 13.9, 15.8, 18.9, 23, 27, 31.4, 35, 38.8, 40.9, 44.2, 47, 51.6, 57.8, 60, 63.8, 68.8, 71.6, 74, 75.6, 76.6, 79.6, 81.2, 83.4, 87]) {
      await seek(page, Math.round(time * 30));
      review.push({ png: await page.screenshot({ type: "png" }), caption: `${time}s` });
    }
    await sheet("review-frames.png", review, 4, 470);
    console.log(`Storyboard: ${stills.length} stills, ${review.length} review frames.`);
  } else {
    const rough = mode === "rough";
    const fps = rough ? 10 : 30;
    const total = 90 * fps;
    const workers = Number(process.env.RENDER_WORKERS ?? 4);
    const parts = [];
    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        const start = Math.floor((total * worker) / workers);
        const end = Math.floor((total * (worker + 1)) / workers);
        const page = await openFilm();
        const path = join(output, `.${mode}-part-${worker}.mp4`);
        parts[worker] = path;
        const { child, done } = ffmpeg([
          "-f", "image2pipe", "-framerate", String(fps), "-c:v", rough ? "mjpeg" : "png", "-i", "pipe:0",
          "-an", "-c:v", "libx264", "-preset", rough ? "veryfast" : "slow", "-crf", rough ? "26" : "14",
          "-tune", "animation", "-vf", `${rough ? "scale=960:540:flags=lanczos," : ""}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
          "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
          "-threads", "2", path,
        ]);
        for (let frame = start; frame < end; frame++) {
          await seek(page, rough ? frame * 3 : frame);
          const image = await page.screenshot(rough ? { type: "jpeg", quality: 85 } : { type: "png" });
          if (!child.stdin.write(image)) await once(child.stdin, "drain");
          if ((frame - start) % 150 === 0) console.log(`${mode} ${worker + 1}/${workers}: ${frame - start}/${end - start}`);
        }
        child.stdin.end();
        await done;
        await page.context().close();
      }),
    );
    const list = join(output, `.${mode}-parts.txt`);
    await writeFile(list, parts.map((path) => `file '${path}'`).join("\n"));
    const name = rough ? "misty-walkthrough-rough.mp4" : "misty-walkthrough-silent.mp4";
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", join(output, name)]).done;
    console.log(`Saved output/${name}`);
  }
  if (errors.length) throw new Error(`Render problems:\n${[...new Set(errors)].join("\n")}`);
} finally {
  await browser.close();
}
