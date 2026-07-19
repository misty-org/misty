import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repositoryRoot, "src");
const protectedRoots = [
  resolve(sourceRoot, "components/misty"),
  resolve(sourceRoot, "pages/Account"),
  resolve(sourceRoot, "pages/Agents"),
  resolve(sourceRoot, "pages/Home"),
  resolve(sourceRoot, "pages/Providers"),
  resolve(sourceRoot, "pages/Settings"),
  resolve(sourceRoot, "pages/Spaces"),
  resolve(sourceRoot, "pages/Studio"),
  resolve(sourceRoot, "pages/Transfers"),
];
const sourceExtensions = new Set([".ts", ".tsx"]);
const failures = [];

for (const path of walk(sourceRoot)) {
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
  const text = readFileSync(path, "utf8");
  const repositoryPath = relative(repositoryRoot, path).split("\\").join("/");

  if (!repositoryPath.startsWith("src/components/ui/") && /from\s+["'](?:@radix-ui\/|radix-ui["'])/.test(text)) {
    failures.push(`${repositoryPath}: import Radix only inside src/components/ui; consume the shadcn wrapper elsewhere`);
  }

  if (repositoryPath.startsWith("src/components/ui/")) {
    reportMatches(repositoryPath, text, /\[--(?:radix|cmdk|reka)-[^\]]+\]/g, "wrap CSS custom properties in var(...) inside Tailwind arbitrary values");
  }

  if (!protectedRoots.some((root) => path === root || path.startsWith(`${root}/`))) continue;
  reportMatches(repositoryPath, text, /<(?:button|input|select|textarea)\b/g, "use the shared shadcn control instead of a raw interactive element");
  reportMatches(repositoryPath, text, /\bfixed\s+inset-0\b/g, "use Dialog, AlertDialog, Sheet, or another shared overlay primitive");
  reportMatches(repositoryPath, text, /\bcreatePortal\s*\(/g, "let the shared overlay primitive own its portal");
  reportMatches(repositoryPath, text, /\bz-\[\d{4,}\]/g, "use a named --misty-layer-* token instead of a hard-coded portal layer");
}

if (failures.length) {
  console.error("UI contract check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("UI contract check passed (migrated Misty pages use the shared interaction layer).")

function reportMatches(path, text, pattern, guidance) {
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    failures.push(`${path}:${line}: ${guidance}`);
  }
}

function walk(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) paths.push(path);
  }
  return paths;
}
