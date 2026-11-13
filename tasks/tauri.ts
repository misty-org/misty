import { run } from "@tauri-apps/cli";
import { prepareTauriDevelopment } from "./dev-signing.ts";
import { stopDescendants, whenStranded } from "./stranded.ts";

// The Tauri CLI runs in this process and leaves its cargo build, the app and Vite behind when this process is
// stopped, so this stops them first. Ctrl+C is the CLI's own and reaches the whole foreground group anyway.
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  if (process.platform !== "win32") await stopDescendants().catch(() => {});
  process.exit(code);
}
process.on("SIGTERM", () => void stop(128 + 15));
process.on("SIGHUP", () => void stop(128 + 1));
whenStranded(() => void stop(1));

try {
  const args = process.argv.slice(2);
  await run(prepareTauriDevelopment(args), "npm run tauri --");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
