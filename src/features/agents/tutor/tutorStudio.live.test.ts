import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { infographicPrompt, parseInfographic, parseVideo, videoPrompt } from "./tutorStudio";

/**
 * Tutor's studio prompts sent to a real engine (Codex, as the person's own engine would be), and its
 * answers read the way Tutor reads them. Runs only with TUTOR_LIVE=1, since it uses the person's
 * Codex sign-in and takes minutes.
 */
const live = process.env.TUTOR_LIVE === "1";

function codex(prompt: string): string {
  const folder = mkdtempSync(join(tmpdir(), "tutor-live-"));
  const answer = join(folder, "answer.txt");
  execFileSync(
    "codex",
    [
      "exec",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      // The model Misty's own Codex runs ask for; a config default may not suit the sign-in.
      "-m",
      process.env.TUTOR_LIVE_MODEL ?? "gpt-5.6-terra",
      "--output-last-message",
      answer,
      "-",
    ],
    { cwd: folder, input: prompt, stdio: ["pipe", "ignore", "ignore"], timeout: 9 * 60_000 },
  );
  return readFileSync(answer, "utf8");
}

describe.runIf(live)("studio prompts on a real engine", () => {
  const topic = "How photosynthesis works";

  it(
    "gets an infographic Tutor can show",
    () => {
      const svg = parseInfographic(codex(infographicPrompt(topic)));
      // TUTOR_LIVE_OUT keeps the drawing, to look at.
      if (svg && process.env.TUTOR_LIVE_OUT) writeFileSync(process.env.TUTOR_LIVE_OUT, svg);
      expect(svg).toMatch(/^<svg/);
      expect(svg).toContain("viewBox");
      expect(svg).not.toMatch(/<script|onload=|foreignObject/i);
    },
    10 * 60_000,
  );

  it(
    "gets a video overview Tutor can play",
    () => {
      const video = parseVideo(codex(videoPrompt(topic)));
      expect(video?.scenes.length).toBeGreaterThanOrEqual(4);
      expect(video?.scenes.every((scene) => scene.narration.length > 20)).toBe(true);
      expect(video?.scenes.filter((scene) => scene.svg).length).toBeGreaterThanOrEqual(3);
    },
    10 * 60_000,
  );
});
