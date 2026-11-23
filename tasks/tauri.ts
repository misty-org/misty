import { run } from "@tauri-apps/cli";
import { prepareTauriDevelopment } from "./dev_signing.ts";
import { stopDescendants, whenStranded } from "./stranded.ts";

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
