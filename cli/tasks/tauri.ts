import { run } from "@tauri-apps/cli";
import { prepareTauriDevelopment } from "./dev-signing.ts";

try {
  const args = process.argv.slice(2);
  await run(prepareTauriDevelopment(args), "npm run tauri --");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
