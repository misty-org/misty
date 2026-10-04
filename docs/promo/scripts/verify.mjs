import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { dependency, browserOptions } from "./runtime.mjs";
import { scenes, FPS, DURATION } from "../timeline.ts";
const output = resolve(import.meta.dirname, "../output");
const { chromium } = dependency("playwright");
const browser = await chromium.launch(browserOptions(chromium));
const findings = [];
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5290/?render=1", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.promoReady);
  await page.evaluate(() => document.fonts.ready);
  for (const [time, text] of [
    [4, "Misty"],
    [15, "Website launch"],
    [21, "Launch brief"],
    [24, "Review homepage"],
    [28, "homepage-layout.png"],
    [34, "Sam Park"],
    [38, "Product section reviewed"],
    [40.4, "Sam Park"],
    [47, "Studio Mac"],
    [53, "Transfer complete"],
    [57, "Turn the launch brief"],
    [63, "Website launch checklist"],
    [75.4, "This device"],
    [77.3, "Workspace restored"],
    [82, "Work laptop"],
    [87, "Try the beta"],
  ]) {
    await page.evaluate((t) => window.renderFrame(t * 30), time);
    const content = await page.locator(".film").innerText();
    assert(content.includes(text), `${time}s lacks ${text}`);
    assert(!/keep working|built for you|wherever you pick up|ultimate|fastest/i.test(content));
    findings.push(`${time}s: ${text}`);
  }
  for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i - 1].end, scenes[i].start);
  assert.equal(scenes[0].start, 0);
  assert.equal(scenes.at(-1).end, DURATION);
  await page.evaluate(() => window.renderFrame(63 * 30));
  const hash = (buf) => createHash("sha256").update(buf).digest("hex");
  const first = hash(await page.screenshot());
  await page.evaluate(() => window.renderFrame(21 * 30));
  await page.evaluate(() => window.renderFrame(63 * 30));
  assert.equal(first, hash(await page.screenshot()), "Seeking must produce identical frames");
  findings.push("Deterministic frame seeking: exact screenshot hash match");
  // Review UI keyboard controls and responsive fit, outside the encoded frame.
  await page.goto("http://127.0.0.1:5290/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  assert(Number(await page.locator(".film").getAttribute("data-time")) > 0);
  await page.getByLabel("Scene", { exact: true }).selectOption("files");
  assert.equal(await page.locator(".film").getAttribute("data-scene"), "files");
  await page.setViewportSize({ width: 720, height: 600 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  findings.push("Preview play/pause, scene selection, and narrow-window fit passed");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
const videos = {};
for (const filename of ["misty-silent.mp4", "misty-promo.mp4"]) {
  const path = join(output, filename);
  if (!existsSync(path)) continue;
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0);
  const metadata = JSON.parse(probe.stdout);
  const video = metadata.streams.find((s) => s.codec_type === "video");
  assert.equal(video.width, 1920);
  assert.equal(video.height, 1080);
  assert.equal(video.r_frame_rate, `${FPS}/1`);
  assert.equal(Number(video.nb_frames), DURATION * FPS);
  assert(Math.abs(Number(metadata.format.duration) - DURATION) < 0.05);
  assert.equal(video.pix_fmt, "yuv420p");
  const audio = metadata.streams.find((s) => s.codec_type === "audio");
  if (filename === "misty-silent.mp4") assert.equal(audio, undefined);
  else {
    assert.equal(audio.channels, 2);
    assert.equal(audio.sample_rate, "48000");
  }
  videos[filename] = {
    width: video.width,
    height: video.height,
    frames: Number(video.nb_frames),
    fps: video.r_frame_rate,
    duration: Number(metadata.format.duration),
    audio: audio
      ? `${audio.codec_name} / ${audio.channels} channels / ${audio.sample_rate} Hz`
      : "none",
  };
}
writeFileSync(
  join(output, "verification.json"),
  JSON.stringify({ findings, errors, videos }, null, 2),
);
console.log(JSON.stringify({ checks: findings.length, errors, videos }, null, 2));
