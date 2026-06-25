import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, "../..");
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "sdk:build"], {cwd: root, stdio: "inherit"});
const { mistyBrowserProviders } = await import(pathToFileURL(resolve(root, "packages/contracts/dist/index.js")).href);
writeFileSync(resolve(root, "src-tauri/src/infra/browser-providers.json"), JSON.stringify(mistyBrowserProviders, null, 2) + "\n");

const hash = createHash("sha256");
for (const name of ["contracts", "sdk"]) {
  const dist = resolve(root, "packages", name, "dist");
  for (const file of readdirSync(dist).filter(file => !file.startsWith(".")).sort()) hash.update(file).update(readFileSync(resolve(dist, file)));
}
const marker = resolve(root, "packages/sdk/dist/.build-revision");
writeFileSync(marker + ".tmp", hash.digest("hex"));
renameSync(marker + ".tmp", marker);
