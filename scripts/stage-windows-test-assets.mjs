import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(argumentValue("--source") ?? join(homedir(), ".misty", "assets"));
const destination = resolve(
  argumentValue("--destination") ?? join(appDir, ".windows-test", ".misty", "assets"),
);

if (!existsSync(source)) {
  throw new Error(`Misty assets were not found at ${source}`);
}

if (samePath(source, destination)) {
  console.log(`Assets are already staged at ${destination}`);
  process.exit(0);
}

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, {
  filter(path) {
    return ![".DS_Store", "Thumbs.db", "desktop.ini"].includes(path.split(/[\\/]/).at(-1));
  },
  recursive: true,
});

const fileCount = countFiles(destination);
console.log(`Staged ${fileCount} Misty asset files.`);
console.log(`Source:      ${source}`);
console.log(`Destination: ${destination}`);
console.log("Copy the repository (including .windows-test) to the Windows test machine.");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path.`);
  }
  return value;
}

function countFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (count, entry) => count + (entry.isDirectory() ? countFiles(join(directory, entry.name)) : 1),
    0,
  );
}

function samePath(left, right) {
  const normalize = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(resolve(left)) === normalize(resolve(right));
}
