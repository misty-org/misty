import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const mistyHome = process.env.MISTY_HOME
  ? resolve(process.env.MISTY_HOME)
  : join(homedir(), ".misty");
const rclonePath = process.env.MISTY_RCLONE_BIN ?? join(mistyHome, "rclone", "rclone");
const rcloneConfig = process.env.MISTY_RCLONE_CONFIG ?? join(mistyHome, "rclone", "rclone.conf");
const cacheRoot = join(mistyHome, ".cache");
const currentRemoteCache = join(cacheRoot, "remote-files", "v1");
const legacyRemoteOpenCache = join(cacheRoot, "remote-open", "v1");
const maxRemotes = Number.parseInt(process.env.MISTY_DIAG_REMOTE_LIMIT ?? "5", 10);
const maxEntries = Number.parseInt(process.env.MISTY_DIAG_ENTRY_LIMIT ?? "8", 10);

const failures = [];

console.log(`Misty home: ${mistyHome}`);
console.log(`Bundled rclone: ${rclonePath}`);
console.log(`Rclone config: ${rcloneConfig}`);

if (!existsSync(rclonePath)) {
  fail(`Bundled rclone was not found at ${rclonePath}`);
} else if (!existsSync(rcloneConfig)) {
  fail(`Rclone config was not found at ${rcloneConfig}`);
} else {
  const version = run(rclonePath, ["--config", rcloneConfig, "version"], { timeout: 10_000 });
  if (version.status === 0) {
    console.log(`\nRclone version:\n${firstLines(version.stdout, 3)}`);
  } else {
    fail(`rclone version failed: ${version.stderr || version.stdout}`);
  }

  const remotesResult = run(rclonePath, ["--config", rcloneConfig, "listremotes"], { timeout: 10_000 });
  if (remotesResult.status === 0) {
    const remotes = remotesResult.stdout
      .split(/\r?\n/)
      .map((remote) => remote.trim())
      .filter(Boolean);
    console.log(`\nConfigured remotes (${remotes.length}): ${remotes.join(", ") || "none"}`);
    for (const remote of remotes.slice(0, Number.isFinite(maxRemotes) ? maxRemotes : 5)) {
      const listing = run(
        rclonePath,
        [
          "--config",
          rcloneConfig,
          "lsf",
          remote,
          "--max-depth",
          "1",
          "--format",
          "pst",
          "--separator",
          " | ",
        ],
        { timeout: 20_000 },
      );
      if (listing.status === 0) {
        const lines = listing.stdout.split(/\r?\n/).filter(Boolean);
        console.log(`\n${remote} shallow listing (${Math.min(lines.length, maxEntries)} shown):`);
        console.log(lines.slice(0, maxEntries).join("\n") || "  no entries");
      } else {
        fail(`${remote} shallow listing failed: ${listing.stderr || listing.stdout}`);
      }
    }
  } else {
    fail(`rclone listremotes failed: ${remotesResult.stderr || remotesResult.stdout}`);
  }
}

console.log("\nRemote file cache indexes:");
summarizeCache("current remote-files/v1", currentRemoteCache);
summarizeCache("legacy remote-open/v1", legacyRemoteOpenCache);

if (failures.length > 0) {
  console.error(`\nRemote/cache diagnostic completed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("\nRemote/cache diagnostic completed successfully.");

function summarizeCache(label, root) {
  const indexPath = join(root, "index.json");
  if (!existsSync(indexPath)) {
    console.log(`- ${label}: no index at ${indexPath}`);
    return;
  }
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch (error) {
    fail(`${label}: could not parse ${indexPath}: ${error.message}`);
    return;
  }
  const entries = Object.entries(index.entries ?? {})
    .filter(([, entry]) => entry?.type === "remote_file");
  const existing = entries.filter(([, entry]) => entry.path && existsSync(entry.path));
  const nested = entries.filter(([, entry]) => String(entry.path ?? "").includes("/remote-files/v1/remote-files/"));
  console.log(`- ${label}: ${entries.length} remote-file index entries, ${existing.length} existing paths, ${nested.length} nested legacy-layout paths`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    ...options,
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? result.error?.message ?? "",
  };
}

function fail(message) {
  failures.push(message.trim());
}

function firstLines(value, count) {
  return value.split(/\r?\n/).slice(0, count).join("\n");
}
