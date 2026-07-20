import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, relative, resolve } from "node:path";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const sourceRoot = resolve(repositoryRoot, "src");
const maxLineLength = 160;
const baselinePath = resolve(repositoryRoot, "scripts/readability-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const sourceExtensions = new Set([".ts", ".tsx", ".css"]);
const observed = new Map();
const failures = [];

for (const path of walk(sourceRoot)) {
  const repositoryPath = relative(repositoryRoot, path).split("\\").join("/");
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.length <= maxLineLength) return;
    if (isAllowedLongLine(line)) return;
    if (isBaselined(repositoryPath, line)) return;

    failures.push(`${repositoryPath}:${index + 1}: ${line.length} characters`);
  });
}

for (const [path, entries] of Object.entries(baseline)) {
  const observedEntries = observed.get(path) ?? new Set();

  for (const entry of entries) {
    const key = baselineKey(entry);
    if (!observedEntries.has(key)) {
      failures.push(`${path}: remove stale readability baseline entry ${entry.hash}`);
    }
  }
}

if (failures.length) {
  console.error(`Readability check failed: lines must be ${maxLineLength} characters or less.\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Readability check passed (frontend lines <= ${maxLineLength} characters).`);

function isAllowedLongLine(line) {
  const trimmed = line.trim();

  return (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("//") ||
    trimmed.includes("http://") ||
    trimmed.includes("https://")
  );
}

function isBaselined(path, line) {
  const entry = {
    length: line.length,
    hash: hashLine(line),
  };
  const key = baselineKey(entry);
  const observedEntries = observed.get(path) ?? new Set();
  observedEntries.add(key);
  observed.set(path, observedEntries);

  return (baseline[path] ?? []).some((candidate) => baselineKey(candidate) === key);
}

function baselineKey(entry) {
  return `${entry.length}:${entry.hash}`;
}

function hashLine(line) {
  return createHash("sha256").update(line).digest("hex").slice(0, 16);
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
