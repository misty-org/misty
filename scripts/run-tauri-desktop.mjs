import { spawnSync } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceLibDir = resolve(appDir, "src-tauri/target/misty-service/host");
const signedMacosRunner = resolve(appDir, "scripts/run-signed-macos-binary.sh");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const devPort = await findAvailablePort(Number(process.env.MISTY_DESKTOP_DEV_PORT ?? 5173));
const devUrl = `http://127.0.0.1:${devPort}`;
const tauriDevConfig = JSON.stringify({
  build: {
    devUrl,
    beforeDevCommand: "npm run dev:desktop",
  },
});

if (devPort !== 5173) {
  console.warn(`Desktop dev port 5173 is busy; using ${devPort} for this Tauri session.`);
}

run(npmCommand, ["run", "service:archive"]);
run(
  npmCommand,
  ["run", "tauri", "--", "dev", "--features=embedded-storage-go", "--config", tauriDevConfig],
  {
    MISTY_DESKTOP_DEV_PORT: String(devPort),
    MISTY_SERVICE_GO_LIB_DIR: serviceLibDir,
    ...(process.platform === "darwin"
      ? {
          CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER: signedMacosRunner,
          CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER: signedMacosRunner,
        }
      : {}),
  },
);

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
