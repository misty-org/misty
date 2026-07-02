import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proxyDir = resolve(appDir, "../misty-proxy");
const proxyArchiveScript = resolve(proxyDir, "scripts/build-carchive.sh");
const proxyLibDir = resolve(appDir, "src-tauri/target/misty-proxy/host");
const forceEmbedded = process.argv.includes("--embedded");
const canBuildEmbeddedProxy = existsSync(proxyArchiveScript);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

if (forceEmbedded || canBuildEmbeddedProxy) {
  if (!canBuildEmbeddedProxy) {
    console.error(
      `Embedded proxy archive script was not found at ${proxyArchiveScript}.`,
    );
    process.exit(1);
  }

  run(npmCommand, ["run", "proxy:archive"]);
  run(
    npmCommand,
    ["run", "tauri", "--", "dev", "--features=embedded-proxy-go"],
    {
      MISTY_PROXY_RUNTIME: "embedded",
      MISTY_PROXY_GO_LIB_DIR: proxyLibDir,
      MISTY_PROXY_GO_LIB_NAME: "misty_proxy",
    },
  );
} else {
  console.warn(
    `Embedded proxy archive script was not found at ${proxyArchiveScript}; starting desktop dev with the proxy runtime disabled.`,
  );
  run(npmCommand, ["run", "tauri", "--", "dev"], {
    MISTY_PROXY_RUNTIME: process.env.MISTY_PROXY_RUNTIME ?? "disabled",
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
