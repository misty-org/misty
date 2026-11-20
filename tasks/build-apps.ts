// Builds each app under apps/ (apps on misty-sdk, each its own package) and copies its bundle into
// src-tauri/resources/apps/<name>, where Misty ships it and seeds it into the app cache at launch.
//   node tasks/build-apps.ts [name...]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const appsDir = join(root, "apps");
const outDir = join(root, "src-tauri", "resources", "apps");
const wanted = process.argv.slice(2);
const names = readdirSync(appsDir).filter(
  (name) =>
    statSync(join(appsDir, name)).isDirectory() && (wanted.length === 0 || wanted.includes(name)),
);

const run = (cwd: string, args: string[]) => {
  const result = spawnSync("npm", args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed in ${cwd}`);
};

mkdirSync(outDir, { recursive: true });
for (const name of names) {
  const dir = join(appsDir, name);
  if (!existsSync(join(dir, "node_modules"))) run(dir, ["install", "--no-audit", "--no-fund"]);
  run(dir, ["run", "build"]);
  const target = join(outDir, name);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(dir, "dist"), target, { recursive: true });
  console.log(`apps/${name} -> src-tauri/resources/apps/${name}`);
}
