import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execute = process.argv.includes("--execute");
const candidates = new Set([
  "dist",
  "build",
  ".vite",
  "node_modules/.vite",
  "design-qa",
  "design-qa-output",
  "artifacts/design-qa",
  "src-tauri/target",
  "src-tauri/gen/apple/build",
  "src-tauri/gen/apple/DerivedData",
  "src-tauri/gen/apple/Externals",
  "src-tauri/gen/apple/Pods",
  "src-tauri/gen/android/.gradle",
].map((path) => resolve(root, path)));

collectNamedDirectories(resolve(root, "src-tauri/gen/android"), "build", candidates);
collectNamedFiles(root, ".DS_Store", candidates);

const existing = [...candidates]
  .filter(existsSync)
  .filter(isSafeCandidate)
  .sort((left, right) => left.localeCompare(right));

if (existing.length === 0) {
  console.log("No generated files matched the cleanup policy.");
  process.exit(0);
}

let reclaimedKiB = 0;
for (const path of existing) {
  const label = relative(root, path) || ".";
  const size = diskUsageKiB(path);
  if (!execute) {
    console.log(`would remove  ${label} (${formatKiB(size)})`);
    reclaimedKiB += size;
    continue;
  }
  if (isInUse(path)) {
    console.log(`skip (in use)  ${label} (${formatKiB(size)})`);
    continue;
  }
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    const reason = error instanceof Error && "code" in error ? String(error.code) : "changed during cleanup";
    console.log(`skip (became active: ${reason})  ${label}`);
    continue;
  }
  console.log(`remove  ${label} (${formatKiB(size)})`);
  reclaimedKiB += size;
}

console.log(`${execute ? "Reclaimed" : "Reclaimable"}: ${formatKiB(reclaimedKiB)}.`);
if (!execute) console.log("Run `npm run clean` to remove these generated files.");

function collectNamedDirectories(directory, name, output) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === name) output.add(path);
    else collectNamedDirectories(path, name, output);
  }
}

function collectNamedFiles(directory, name, output) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "rclone", "target"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) collectNamedFiles(path, name, output);
    else if (entry.isFile() && entry.name === name) output.add(path);
  }
}

function isSafeCandidate(path) {
  const relativePath = relative(root, path);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === "..") return false;
  if (relativePath === "service/rclone" || relativePath.startsWith(`service${sep}rclone${sep}`)) return false;
  if (/(^|[/\\])\.env([^/\\]*)$/.test(relativePath) || /signing/i.test(relativePath)) return false;
  if (relativePath === "node_modules") return false;
  return true;
}

function isInUse(path) {
  const result = spawnSync("lsof", ["-t", "+D", path], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function diskUsageKiB(path) {
  const result = spawnSync("du", ["-sk", path], { encoding: "utf8" });
  const value = Number.parseInt(result.stdout, 10);
  return Number.isFinite(value) ? value : 0;
}

function formatKiB(kibibytes) {
  if (kibibytes >= 1_048_576) return `${(kibibytes / 1_048_576).toFixed(1)} GiB`;
  if (kibibytes >= 1024) return `${(kibibytes / 1024).toFixed(1)} MiB`;
  return `${kibibytes} KiB`;
}
