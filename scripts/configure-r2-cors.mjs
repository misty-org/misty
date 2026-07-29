#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const bucket = requireValue("R2_BUCKET");
const origins = requireValue("MISTY_R2_ALLOWED_ORIGINS")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (origins.length === 0 || new Set(origins).size !== origins.length) {
  fail("MISTY_R2_ALLOWED_ORIGINS must contain unique, comma-separated origins");
}
for (const origin of origins) {
  validateOrigin(origin);
}

const config = {
  rules: [
    {
      allowed: {
        origins,
        methods: ["GET", "HEAD", "PUT"],
        headers: [
          "content-type",
          "x-amz-checksum-sha256",
          "x-amz-meta-misty-library-sha256",
        ],
      },
      exposeHeaders: ["etag", "x-amz-checksum-sha256"],
      maxAgeSeconds: 3600,
    },
  ],
};

const temporary = mkdtempSync(join(tmpdir(), "misty-r2-cors-"));
const configPath = join(temporary, "cors.json");
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

const wrangler = resolve(
  "cloudflare/journal-collab/node_modules/.bin/wrangler",
);
try {
  if (process.env.MISTY_R2_CORS_DRY_RUN === "1") {
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
  } else {
    run(wrangler, [
      "r2",
      "bucket",
      "cors",
      "set",
      bucket,
      "--file",
      configPath,
      "--force",
    ]);
    run(wrangler, ["r2", "bucket", "cors", "list", bucket]);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function validateOrigin(raw) {
  if (raw.includes("*")) {
    fail(`wildcard R2 origin is forbidden: ${raw}`);
  }
  let value;
  try {
    value = new URL(raw);
  } catch {
    fail(`invalid R2 origin: ${raw}`);
  }
  if (
    value.username ||
    value.password ||
    (value.pathname !== "" && value.pathname !== "/") ||
    value.search ||
    value.hash
  ) {
    fail(`R2 origins must not contain credentials, paths, queries, or fragments: ${raw}`);
  }
  const secure = value.protocol === "https:";
  const packagedMac = value.protocol === "tauri:" && value.hostname === "localhost";
  const local =
    value.protocol === "http:" &&
    (value.hostname === "localhost" ||
      value.hostname === "127.0.0.1" ||
      value.hostname === "tauri.localhost");
  if (!secure && !packagedMac && !local) {
    fail(`R2 origin must use HTTPS or be an approved local/Tauri origin: ${raw}`);
  }
}

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`${name} is required`);
  }
  return value;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`R2 CORS configuration failed: ${message}`);
  process.exit(1);
}
