import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const checkout = process.argv[2] ?? join(root, "..", "misty-registry");
const site = join(checkout, "site");
const source = join(site, "index.min.json");
if (!existsSync(source))
  throw new Error(
    "No site/index.min.json found: run `npm run build` in a misty-registry checkout and pass its path.",
  );
const text = readFileSync(source, "utf8");
const index = JSON.parse(text) as {
  sections: Record<string, { path: string }>;
  listings: Record<string, { top: { path: string } }>;
};
const paths = [
  ...Object.values(index.sections).map((section) => section.path),
  ...Object.values(index.listings).map((listing) => listing.top.path),
];
const shards: Record<string, string> = {};
for (const path of paths) shards[path] = readFileSync(join(site, path), "utf8");
const target = join(root, "src", "shared", "registry");
writeFileSync(join(target, "index.min.json"), text);
writeFileSync(join(target, "shards.json"), JSON.stringify(shards));
rmSync(join(target, "registry.json"), { force: true });
console.log(
  `index.min.json, its sections and each top shard (${Object.keys(shards).length} shards) <- ${site}`,
);
