// Copies misty-catalog's pins (every app, speech model, voice and engine Misty lists, each pointing at its maker's own
// release) into Misty, which carries them with its release.
//   node tasks/sync-catalog.ts [path to a misty-catalog checkout]   (default: the one beside this repository)
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A URL's pathname is `/C:/…` on Windows; fileURLToPath gives the real path everywhere.
const root = fileURLToPath(new URL("..", import.meta.url));
// The checkout beside this one: misty-catalog, or misty-apps until it is renamed.
const beside = ["misty-catalog", "misty-apps"]
  .map((name) => join(root, "..", name))
  .find((folder) => existsSync(join(folder, "catalog.json")));
const checkout = process.argv[2] ?? beside;
if (!checkout || !existsSync(join(checkout, "catalog.json")))
  throw new Error("No catalog found: pass the path to a misty-catalog checkout.");
const copies: [string, string][] = [
  ["catalog.json", join(root, "src", "features", "spaces", "apps", "catalog.json")],
  ["speech.json", join(root, "src-tauri", "features", "voice", "speech_catalog.json")],
  ["engines.json", join(root, "src", "features", "agents", "marketplace", "engines.json")],
];
for (const [name, target] of copies) {
  const source = join(checkout, name);
  if (!existsSync(source))
    throw new Error(`No ${name} in ${checkout}: run npm run build there first.`);
  copyFileSync(source, target);
  console.log(`${name} <- ${source}`);
}
