import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Builds and runs the live desktop pointer check (macOS, needs Accessibility
// for the terminal). It edits only a scratch text file it creates.
const native = new URL("../../src-tauri/native/macos/", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "misty-desktop-check-"));
const binary = join(dir, "AgentPointerCheck");
const file = join(dir, "Misty desktop check.txt");
writeFileSync(file, "Scratch file for Misty's desktop pointer check.");
execFileSync(
  "clang",
  [
    "-fobjc-arc",
    "-framework", "AppKit",
    "-framework", "ApplicationServices",
    "-framework", "Carbon",
    "-framework", "QuartzCore",
    join(native, "MistyAgentPointer.m"),
    join(native, "MistyAgentRing.m"),
    join(native, "checks/AgentPointerCheck.m"),
    "-o",
    binary,
  ],
  { stdio: "inherit" },
);
try {
  execFileSync(binary, [file], { stdio: "inherit" });
} catch {
  // The check printed why it failed.
  process.exitCode = 1;
}
