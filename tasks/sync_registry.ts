import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const checkout = process.argv[2] ?? join(root, "..", "misty-registry");
const source = join(checkout, "registry.json");
if (!existsSync(source))
  throw new Error("No registry.json found: pass the path to a misty-registry checkout.");
const target = join(root, "src", "shared", "registry", "registry.json");
copyFileSync(source, target);
console.log(`registry.json <- ${source}`);
