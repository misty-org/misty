import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const cargoToml = await readFile(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
const expected = process.env.RELEASE_VERSION?.trim().replace(/^misty-v/, "").replace(/^v/, "");

if (!expected) throw new Error("RELEASE_VERSION must be a misty-vX.Y.Z tag or X.Y.Z version.");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expected)) {
  throw new Error(`RELEASE_VERSION is not valid semantic version syntax: ${expected}`);
}

const versions = {
  "package.json": packageJson.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriConfig.version,
};
const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  throw new Error(
    `Release version ${expected} does not match: ${mismatches
      .map(([file, version]) => `${file}=${version ?? "missing"}`)
      .join(", ")}`,
  );
}

console.log(`Misty ${expected} release metadata is consistent.`);
