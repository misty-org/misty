import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proxyDir = resolve(appDir, "../misty-proxy");
const script = resolve(proxyDir, "scripts/build-carchive.sh");
const target = process.env.MISTY_PROXY_GO_TARGET ?? "host";
const outDir =
  process.env.MISTY_PROXY_GO_OUT_DIR ??
  resolve(appDir, "src-tauri/target/misty-proxy", target);

const result = spawnSync(script, {
  cwd: proxyDir,
  stdio: "inherit",
  env: {
    ...process.env,
    MISTY_PROXY_GO_TARGET: target,
    MISTY_PROXY_GO_OUT_DIR: outDir,
    MISTY_PROXY_GO_LIB_NAME: process.env.MISTY_PROXY_GO_LIB_NAME ?? "misty_proxy",
  },
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
