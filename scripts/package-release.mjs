import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(repo, "dist/plugins");
const artifacts = path.join(repo, "artifacts");
const index = JSON.parse(
  await readFile(path.join(repo, "catalog/index.json"), "utf8"),
);
const packageVersion = JSON.parse(
  await readFile(path.join(repo, "package.json"), "utf8"),
).version;
const supportedPlatforms = new Set(["macos-aarch64", "macos-x86_64"]);
const platforms = (process.env.TARGET_PLATFORMS || "macos-aarch64,macos-x86_64")
  .split(",")
  .filter(Boolean);
for (const platform of platforms) {
  if (!supportedPlatforms.has(platform)) {
    throw new Error(
      `${platform} is not release-enabled until its isolated native App adapter is validated.`,
    );
  }
}
await rm(artifacts, { recursive: true, force: true });
await mkdir(path.join(artifacts, "catalog"), { recursive: true });
for (const entry of index) {
  for (const target of platforms) {
    const source = path.join(dist, entry.id);
    const stage = path.join(artifacts, "stage", entry.id);
    await rm(stage, { recursive: true, force: true });
    await cp(source, stage, { recursive: true });
    const manifestPath = path.join(stage, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.id !== entry.id || manifest.version !== packageVersion) {
      throw new Error(
        `${entry.id} build identity does not match v${packageVersion}.`,
      );
    }
    if ((manifest.tools ?? []).length > 0) {
      throw new Error(`${entry.id} may not ship executable tools.`);
    }
    const zipName = `${entry.id}-${target}.zip`;
    const zipPath = path.join(artifacts, zipName);
    if (process.platform === "win32")
      execFileSync("7z", ["a", "-tzip", "-mx=9", zipPath, entry.id], {
        cwd: path.join(artifacts, "stage"),
      });
    else
      execFileSync("zip", ["-X", "-q", "-r", zipPath, entry.id], {
        cwd: path.join(artifacts, "stage"),
      });
    const sha256 = await digest(zipPath);
    await writeFile(`${zipPath}.sha256`, `${sha256}  ${zipName}\n`);
    const catalog = JSON.parse(
      await readFile(path.join(repo, `catalog/${entry.id}.json`), "utf8"),
    );
    const artifact = catalog.install.artifacts.find(
      (item) => item.platform === target,
    );
    if (!artifact) {
      throw new Error(`${entry.id} does not publish a ${target} artifact.`);
    }
    artifact.sha256 = sha256;
    await writeFile(
      path.join(artifacts, "catalog", `${entry.id}-${target}.json`),
      JSON.stringify(catalog, null, 2) + "\n",
    );
  }
}
await rm(path.join(artifacts, "stage"), { recursive: true, force: true });

async function digest(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
