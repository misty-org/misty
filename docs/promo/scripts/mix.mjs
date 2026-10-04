import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { scenes } from "../timeline.ts";
const output = resolve(import.meta.dirname, "../output");
const chapters = join(output, "chapters.ffmetadata");
writeFileSync(
  chapters,
  ";FFMETADATA1\ntitle=Misty — feature walkthrough\nartist=Misty\n" +
    scenes
      .map(
        (s) =>
          `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${s.start * 1000}\nEND=${s.end * 1000}\ntitle=${s.id === "intro" ? "Introduction" : s.id === "close" ? "Try the beta" : s.title}\n`,
      )
      .join(""),
);
const result = spawnSync(
  process.env.FFMPEG || "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-i",
    join(output, "misty-silent.mp4"),
    "-i",
    join(output, "soundtrack.wav"),
    "-i",
    chapters,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-map_metadata",
    "2",
    "-map_chapters",
    "2",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-ar",
    "48000",
    "-af",
    "loudnorm=I=-20:TP=-2:LRA=8:measured_I=-33.96:measured_TP=-22.34:measured_LRA=2.10:measured_thresh=-44.03:offset=-0.01:linear=true",
    "-t",
    "90",
    "-movflags",
    "+faststart",
    join(output, "misty-promo.mp4"),
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) throw new Error("Audio/video mux failed");
console.log("Saved misty-promo.mp4 with stereo soundtrack and scene chapters.");
