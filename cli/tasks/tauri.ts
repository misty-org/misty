import { run } from "@tauri-apps/cli";
import { prepareTauriDevelopment } from "./dev-signing.ts";
import { developmentBuildEnvironment } from "./dev-build.ts";

try {
  const args = process.argv.slice(2);
  Object.assign(process.env, developmentBuildEnvironment(args));
  await run(prepareTauriDevelopment(args), "npm run tauri --");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
