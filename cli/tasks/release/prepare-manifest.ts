import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { root, readJSON, writeJSON, capture, version, checksums } from "./lib.ts";

const releaseVersion = version(readJSON(resolve(root, "package.json")).version);
const pins = readJSON(resolve(root, "release/pins.json"));
const output = resolve(root, "artifacts", `v${releaseVersion}`);
mkdirSync(output, { recursive: true });
writeJSON(resolve(output, "release-manifest.json"), {
  schemaVersion: 3,
  version: releaseVersion,
  channel: "beta",
  api: "https://dev-api.mistysys.com/v1",
  source: { ...pins, host: capture("git", ["rev-parse", "HEAD"]) },
});
checksums(output);
console.log(`Prepared Misty release manifest in ${output}.`);
