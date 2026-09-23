import { run } from "@tauri-apps/cli";
import { prepareTauriDevelopment } from "./dev-signing.ts";

try {
  await run(prepareTauriDevelopment(process.argv.slice(2)), "npm run tauri --");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
