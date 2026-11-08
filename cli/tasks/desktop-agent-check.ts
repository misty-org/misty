import { spawnSync } from "node:child_process";

// Runs the live desktop pointer check (macOS, needs Accessibility for the
// terminal). It is an ignored Rust test in the app crate that edits only a
// scratch text file it creates.
const crate = new URL("../../src-tauri/", import.meta.url).pathname;
const result = spawnSync(
  "cargo",
  [
    "test",
    "--lib",
    "agent_pointer_clicks_types_and_selects_in_textedit",
    "--",
    "--ignored",
    "--nocapture",
  ],
  { cwd: crate, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
