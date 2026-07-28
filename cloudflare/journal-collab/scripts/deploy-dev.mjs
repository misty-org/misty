/**
 * Deploys an isolated development Worker that can callback into a local Misty
 * server exposed through a public tunnel.
 *
 * Usage:
 *   MISTY_INTERNAL_API_BASE=https://example.trycloudflare.com/api npm run deploy:dev
 *   npm run deploy:dev -- https://example.trycloudflare.com/api
 */
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerName = "misty-journal-collab-dev";
const workerHost = "misty-journal-collab-dev.mistysys.workers.dev";
const devVarsPath = resolve(projectRoot, ".dev.vars");
const localServerEnvPath = resolve(projectRoot, ".secrets/local-dev-server.env");

const apiBase = process.argv[2] ?? process.env.MISTY_INTERNAL_API_BASE ?? "";
let parsed;
try {
  parsed = new URL(apiBase);
} catch {
  console.error("Pass a public HTTPS API base, for example:");
  console.error("  npm run deploy:dev -- https://example.trycloudflare.com/api");
  process.exit(2);
}
if (parsed.protocol !== "https:" || !parsed.pathname.replace(/\/$/, "").endsWith("/api")) {
  console.error("MISTY_INTERNAL_API_BASE must be an https URL ending in /api.");
  process.exit(2);
}
if (!existsSync(devVarsPath)) {
  console.error(".dev.vars is missing. Run `npm run generate-secrets` first.");
  process.exit(2);
}

const result = spawnSync(
  "npx",
  [
    "wrangler",
    "deploy",
    "--name",
    workerName,
    "--var",
    `MISTY_INTERNAL_API_BASE:${parsed.toString().replace(/\/$/, "")}`,
    "--secrets-file",
    ".dev.vars",
  ],
  { cwd: projectRoot, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);

writeFileSync(
  localServerEnvPath,
  [
    "# Local-only override written by npm run deploy:dev.",
    "# This keeps production on misty-journal-collab while local backend uses the dev Worker.",
    `PARTYKIT_HOST=${workerHost}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log("");
console.log(`Development Worker host: ${workerHost}`);
console.log(`Wrote ${localServerEnvPath}`);
console.log("Restart the Go server so it loads the dev Worker override.");
