import { access, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// Publish complete files only. Keep older hashed assets available to open views.
async function publishFiles(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((a, b) => Number(a.name === "app.js") - Number(b.name === "app.js"));
  for (const entry of entries) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory()) await publishFiles(from, to);
    else if (entry.isFile()) await rename(from, to);
    else throw new Error(`Unexpected app build entry: ${entry.name}`);
  }
}

export async function stagedAppBuild(output, build) {
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), ".build-"));
  const stagedOutput = join(staging, basename(output));
  try {
    await build(stagedOutput);
    // A failed or incomplete build cannot replace the working entry point.
    await access(join(stagedOutput, "app.js"));
    await access(join(stagedOutput, "app.css"));
    const optional = join(staging, "optional-assets");
    try { await access(optional); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if ((await readdir(staging)).includes("optional-assets"))
      await publishFiles(optional, join(dirname(output), "optional-assets"));
    await publishFiles(stagedOutput, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
