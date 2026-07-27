import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceLibDir = resolve(appDir, "src-tauri/target/misty-service/host");
const signedMacosRunner = resolve(appDir, "scripts/run-signed-macos-binary.sh");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const desktopProfile = normalizeProfile(
  argumentValue("--profile") ?? process.env.MISTY_PROFILE ?? process.env.MISTY_DESKTOP_PROFILE,
);
const devPort = await findAvailablePort(Number(process.env.MISTY_DESKTOP_DEV_PORT ?? 5173));
const initialRoute = normalizeInitialRoute(process.env.MISTY_DESKTOP_INITIAL_ROUTE);
const devUrl = `http://127.0.0.1:${devPort}${initialRoute}`;
const profileSessionRoot = desktopProfile
  ? resolve(process.env.MISTY_PROFILE_DIR ?? join(homedir(), ".misty", ".profiles", desktopProfile))
  : null;

if (profileSessionRoot) {
  mkdirSync(profileSessionRoot, { recursive: true });
}

// Written to a file rather than passed inline: on Windows, spawnSync requires
// shell:true to run npm.cmd, and cmd.exe mangles quotes in inline JSON args.
const tauriDevConfigPath = join(
  mkdtempSync(join(tmpdir(), "misty-tauri-dev-")),
  "tauri.dev.conf.json",
);
writeFileSync(
  tauriDevConfigPath,
  JSON.stringify({
    ...(desktopProfile
      ? {
          productName: `Misty ${desktopProfile}`,
          identifier: `com.misty.desktop.${desktopProfile}`,
        }
      : {}),
    build: {
      devUrl,
      beforeDevCommand: "npm run dev:desktop",
    },
  }),
);

if (devPort !== 5173) {
  console.warn(`Desktop dev port 5173 is busy; using ${devPort} for this Tauri session.`);
}
if (desktopProfile) {
  console.warn(`Starting Misty desktop profile "${desktopProfile}" at ${profileSessionRoot}.`);
}

run(npmCommand, ["run", "service:archive"]);
run(
  npmCommand,
  ["run", "tauri", "--", "dev", "--features=embedded-storage-go", "--config", tauriDevConfigPath],
  {
    MISTY_DESKTOP_DEV_PORT: String(devPort),
    MISTY_SERVICE_GO_LIB_DIR: serviceLibDir,
    ...(desktopProfile
      ? {
          MISTY_PROFILE: desktopProfile,
          MISTY_DESKTOP_PROFILE: desktopProfile,
          MISTY_PROFILE_DIR: profileSessionRoot,
        }
      : {}),
    ...(process.platform === "darwin"
      ? {
          CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER: signedMacosRunner,
          CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER: signedMacosRunner,
        }
      : {}),
  },
);

function normalizeInitialRoute(value) {
  if (!value) return "";
  const route = String(value).trim();
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("://")) {
    throw new Error("MISTY_DESKTOP_INITIAL_ROUTE must be an absolute in-app path.");
  }
  return route;
}

function normalizeProfile(value) {
  if (!value) return "";
  const profile = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(profile)) {
    throw new Error("Desktop profile names must use 1-32 lowercase letters, numbers, or hyphens.");
  }
  return profile;
}

function argumentValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function findAvailablePort(startPort) {
  const basePort = Number.isFinite(startPort) && startPort > 0 ? Math.floor(startPort) : 5173;
  for (let port = basePort; port < basePort + 50; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No available desktop dev port found from ${basePort} to ${basePort + 49}.`);
}

function canListen(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
