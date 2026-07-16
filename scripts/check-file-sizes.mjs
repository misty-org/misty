import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["src", "src-tauri/src", "scripts"];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".rs", ".sh", ".swift", ".ts", ".tsx"]);
const ignoredDirectories = new Set(["build", "dist", "gen", "node_modules", "target"]);
const defaultLimit = 500;
const baselinePath = resolve(repositoryRoot, "scripts/file-size-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const files = roots.flatMap((root) => walk(resolve(repositoryRoot, root)));
const measured = new Map(files.map((path) => [repositoryPath(path), lineCount(path)]));
const failures = [];

for (const [path, lines] of measured) {
  const ceiling = baseline[path];
  if (lines <= defaultLimit) {
    if (ceiling !== undefined) {
      failures.push(`${path}: now ${lines} lines; remove its stale ${ceiling}-line baseline`);
    }
    continue;
  }
  if (ceiling === undefined) {
    failures.push(`${path}: ${lines} lines exceeds ${defaultLimit} without a baseline`);
  } else if (lines > ceiling) {
    failures.push(`${path}: grew to ${lines} lines (baseline ceiling: ${ceiling})`);
  }
}

for (const [path, ceiling] of Object.entries(baseline)) {
  if (!Number.isInteger(ceiling) || ceiling <= defaultLimit) {
    failures.push(`${path}: baseline ceiling must be an integer above ${defaultLimit}`);
  } else if (!measured.has(path)) {
    failures.push(`${path}: baseline entry does not reference a checked source file`);
  }
}

if (failures.length > 0) {
  console.error("File-size check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const oversized = [...measured.values()].filter((lines) => lines > defaultLimit).length;
console.log(`File-size check passed (${measured.size} files; ${oversized} frozen legacy files).`);

function walk(directory) {
  if (!existsSync(directory)) return [];
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || (entry.isDirectory() && ignoredDirectories.has(entry.name))) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) paths.push(path);
  }
  return paths;
}

function lineCount(path) {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).split("\\").join("/");
}
