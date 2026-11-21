// Copies misty-apps' catalog (the pins to the makers' own releases) into Misty, which carries it with its release.
//   node tasks/sync-apps-catalog.ts [path to a misty-apps checkout]   (default: the one beside this repository)
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A URL's pathname is `/C:/…` on Windows; fileURLToPath gives the real path everywhere.
const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(process.argv[2] ?? join(root, "..", "misty-apps"), "catalog.json");
if (!existsSync(source))
  throw new Error(`No catalog at ${source}: pass the path to a misty-apps checkout.`);
copyFileSync(source, join(root, "src", "features", "spaces", "apps", "catalog.json"));
console.log(`catalog.json <- ${source}`);
