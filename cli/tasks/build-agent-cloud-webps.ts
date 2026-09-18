import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assets = path.join(root, "src/shared/assets/agents");
const scratch = mkdtempSync(path.join(tmpdir(), "misty-cloud-animation-"));
// Same five frame durations as misty-cloud-expression-cycle.webp (4.75 seconds).
const durations = [1200, 650, 850, 1150, 900];
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr}`);
  return result.stdout;
}
function encode(source, output) {
  run("cwebp", ["-quiet", "-lossless", "-m", "6", "-resize", "512", "512", source, "-o", output]);
}

try {
  for (const color of ["lavender", "mint", "peach"]) {
    const first = path.join(scratch, `${color}-first.webp`);
    const alternate = path.join(scratch, `${color}-alternate.webp`);
    encode(path.join(assets, `cloud-${color}.png`), first);
    encode(path.join(assets, "source", `cloud-${color}-alternate.png`), alternate);
    const output = path.join(scratch, `cloud-${color}.webp`);
    run("webpmux", [
      ...durations.flatMap((duration, index) => [
        "-frame",
        index % 2 ? alternate : first,
        `+${duration}+0+0+0-b`,
      ]),
      "-loop",
      "0",
      "-bgcolor",
      "0,0,0,0",
      "-o",
      output,
    ]);
    const metadata = run("webpmux", ["-info", output]);
    if (!metadata.includes("Number of frames: 5") || !metadata.includes("animation transparency")) {
      throw new Error(`Invalid animated WebP for ${color}`);
    }
    copyFileSync(output, path.join(assets, `cloud-${color}.webp`));
    copyFileSync(first, path.join(assets, `cloud-${color}-poster.webp`));
    console.log(`${color}: 512×512, 5 frames, 4.75s, transparent, looping`);
  }

  // Restore the original first frame's canvas offsets for an identical static fallback.
  const skyFrame = path.join(scratch, "sky-frame.webp");
  const skyCanvas = path.join(scratch, "sky-poster.png");
  const skyPoster = path.join(scratch, "sky-poster.webp");
  run("webpmux", [
    "-get",
    "frame",
    "1",
    path.join(assets, "../misty-cloud-expression-cycle.webp"),
    "-o",
    skyFrame,
  ]);
  run("ffmpeg", [
    "-v",
    "error",
    "-i",
    skyFrame,
    "-vf",
    "pad=512:512:26:46:color=0x00000000",
    "-frames:v",
    "1",
    skyCanvas,
  ]);
  encode(skyCanvas, skyPoster);
  copyFileSync(skyPoster, path.join(assets, "cloud-sky-poster.webp"));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
