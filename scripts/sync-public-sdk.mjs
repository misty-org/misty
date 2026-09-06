import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";

const host = resolve(import.meta.dirname, "..");
const source = resolve(process.argv[2] || resolve(host, "../misty-sdk"));
const consumers = [host, resolve(process.env.MISTY_APPS_ROOT || resolve(host, "../misty-apps"))];
const run = (args, cwd, capture = false) =>
  execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
if (!existsSync(resolve(source, "packages/sdk/package.json")))
  throw new Error("Pass the public misty-sdk checkout path to sdk:sync.");
for (const consumer of consumers) {
  if (!existsSync(resolve(consumer, "package.json")))
    throw new Error(`App consumer is missing: ${consumer}`);
}
run(["run", "check"], source);
run(["run", "test:packed"], source);
const temporary = mkdtempSync(resolve(tmpdir(), "misty-sdk-snapshot-"));
try {
  const packages = ["contracts", "sdk"].map((name) => {
    const packed = JSON.parse(
      run(
        ["pack", "--json", "--pack-destination", temporary],
        resolve(source, "packages", name),
        true,
      ),
    )[0];
    const archive = resolve(temporary, packed.filename);
    const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const filename = `${packed.name.replace("@", "").replace("/", "-")}-${packed.version}-${sha256.slice(0, 16)}.tgz`;
    return { name: packed.name, version: packed.version, sha256, filename, archive };
  });
  for (const consumer of consumers) {
    const destination = resolve(consumer, "vendor/misty-sdk");
    mkdirSync(destination, { recursive: true });
    const manifestPath = resolve(destination, "snapshot.json");
    const previous = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf8"))
      : { packages: [] };
    const packagePath = resolve(consumer, "package.json");
    const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
    for (const item of packages) {
      const target = resolve(destination, item.filename);
      copyFileSync(item.archive, `${target}.tmp`);
      renameSync(`${target}.tmp`, target);
      manifest.dependencies[item.name] = `file:${relative(consumer, target)}`;
    }
    writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(
      resolve(destination, "README.md"),
      "# Public Misty SDK packages\n\nSelf-contained npm archives built from the independent misty-sdk repository. They include compiled JavaScript, declarations and source maps with embedded source. No private server source, credentials or sibling workspace links are required.\n\nUpdate from the Host checkout with `npm run sdk:sync -- /path/to/misty-sdk`. The command checks the public source and isolated package consumer before refreshing both the Host and misty-apps snapshots and lockfiles. Archives use content hashes so npm cannot silently reuse an older build of the same development version. Nothing is published by this command.\n",
    );
    run(["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
    // Validate installed entry points in a fresh process before notifying Vite.
    // A failed or partial install must never be published as a ready snapshot.
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'await import("@misty/contracts"); await import("@misty/sdk");',
      ],
      { cwd: consumer, stdio: "inherit" },
    );
    writeFileSync(
      `${manifestPath}.tmp`,
      JSON.stringify(
        { schemaVersion: 1, packages: packages.map(({ archive: _archive, ...item }) => item) },
        null,
        2,
      ) + "\n",
    );
    renameSync(`${manifestPath}.tmp`, manifestPath);
    for (const old of previous.packages) {
      if (
        typeof old.filename !== "string" ||
        !/^misty-(sdk|contracts)-[a-zA-Z0-9.-]+\.tgz$/.test(old.filename)
      )
        continue;
      if (!packages.some((item) => item.filename === old.filename))
        rmSync(resolve(destination, old.filename), { force: true });
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log("Host and app packages now use self-contained public SDK archives.");
