import { mkdirSync, existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicKey, verify } from "node:crypto";
import { root, readJSON, writeJSON, run, capture, sha256, checksums, files } from "./lib.mjs";

// An app-only candidate preserves every other live catalog entry and SDK pin.
const [id, baselineFile, destination] = process.argv.slice(2);
if (!id || !baselineFile || !destination)
  throw new Error(
    "Usage: node scripts/release/prepare-app-update.mjs <app-id> <baseline-catalog.json> <new-output-directory>",
  );
const apps = resolve(process.env.MISTY_APPS_ROOT || resolve(root, "../misty-apps"));
for (const directory of [root, apps]) {
  if (capture("git", ["status", "--porcelain", "--untracked-files=no"], directory))
    throw new Error(
      "Prepare from clean committed source, using an isolated checkout if other work is in progress.",
    );
  for (const pkg of readJSON(resolve(directory, "vendor/misty-sdk/snapshot.json")).packages) {
    if (sha256(resolve(directory, "vendor/misty-sdk", pkg.filename)) !== pkg.sha256)
      throw new Error("Pinned SDK archive failed verification.");
  }
}
const output = resolve(destination);
if (existsSync(output))
  throw new Error("Use a new output directory; prepared app updates are immutable.");
const candidate = readJSON(resolve(baselineFile));
const next = readJSON(resolve(apps, "apps/catalog.json")).apps.find((app) => app.id === id);
const previous = candidate.apps.find((app) => app.id === id);
if (!next || !previous || next.version === previous.version)
  throw new Error("The app needs a new version relative to the baseline catalog.");
if (
  next.scopes.some((scope) => !previous.scopes.includes(scope)) &&
  next.permission_version <= previous.permission_version
)
  throw new Error("Added permissions require an increased permission version.");
const trust = readJSON(resolve(root, "release/trust.json"));
if (candidate.signing?.key_id !== trust.keyId || candidate.signing?.public_key !== trust.publicKey)
  throw new Error("Baseline catalog uses a different release trust key.");
candidate.apps[candidate.apps.indexOf(previous)] = next;
mkdirSync(output, { recursive: true });
const catalogPath = resolve(output, "official-app-catalog.json");
writeJSON(catalogPath, candidate);
const env = {
  MISTY_APPS_ROOT: apps,
  MISTY_OFFICIAL_APP_CATALOG_PATH: catalogPath,
  MISTY_OFFICIAL_APP_PUBLIC_DIR: resolve(output, "upload"),
  MISTY_OFFICIAL_APP_SIGNING_KEY_ID: trust.keyId,
};
run("npm", ["run", "build:official-apps", "--", id], root, env);
run(process.execPath, ["scripts/build-official-apps.mjs", "--release", id], apps, env);
const signed = readJSON(catalogPath);
const app = signed.apps.find((app) => app.id === id);
const archive = resolve(output, "upload", "official-apps", id, app.version, "desktop.zip");
const key = createPublicKey({
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(trust.publicKey, "base64"),
  ]),
  format: "der",
  type: "spki",
});
if (
  signed.signing.public_key !== trust.publicKey ||
  sha256(archive) !== app.desktop.sha256 ||
  !verify(null, readFileSync(archive), key, Buffer.from(app.desktop.signature, "base64"))
)
  throw new Error("Prepared package failed release signature verification.");
for (const entry of signed.apps.filter((a) => a.id !== id)) {
  if (JSON.stringify(entry) !== JSON.stringify(candidate.apps.find((a) => a.id === entry.id)))
    throw new Error("Another app catalog entry changed.");
}
copyFileSync(archive, resolve(output, `${id}-${app.version}-desktop.zip`));
run(
  process.execPath,
  ["scripts/sync-server-official-apps.mjs", resolve(output, "catalog.go"), catalogPath],
  apps,
);
writeJSON(resolve(output, "release-manifest.json"), {
  schemaVersion: 1,
  type: "app-update",
  app: id,
  version: app.version,
  source: {
    host: capture("git", ["rev-parse", "HEAD"]),
    apps: capture("git", ["rev-parse", "HEAD"], apps),
  },
  sdk: readJSON(resolve(root, "vendor/misty-sdk/snapshot.json")),
  previousVersion: previous.version,
  catalogSha256: sha256(catalogPath),
  package: app.desktop,
  permissionVersion: app.permission_version,
  minimumHostVersion: app.minimum_host_version,
  uploads: files(resolve(output, "upload")).map((file) => ({
    key: file.slice(resolve(output, "upload").length + 1),
    bytes: readFileSync(file).length,
    sha256: sha256(file),
  })),
});
checksums(output);
console.log(
  `Prepared ${id} ${app.version}: ${app.desktop.download_bytes} bytes. Upload the contents of ${resolve(output, "upload")} before deploying catalog.go. Nothing was published.`,
);
