import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const local = createRequire(import.meta.url);
export function dependency(name) {
  try {
    return local(name);
  } catch {}
  const bundled = join(
    homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json",
  );
  if (existsSync(join(bundled, "..", "node_modules"))) return createRequire(bundled)(name);
  throw new Error(
    `Install ${name} in this isolated project, or provide the Codex bundled runtime.`,
  );
}
export function browserOptions(chromium) {
  if (process.env.CHROMIUM_PATH)
    return { executablePath: process.env.CHROMIUM_PATH, headless: true };
  if (existsSync(chromium.executablePath())) return { headless: true };
  const root = join(
    homedir(),
    process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright",
  );
  if (existsSync(root))
    for (const name of readdirSync(root)
      .filter((x) => x.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse()) {
      for (const platform of [
        "chrome-headless-shell-mac-arm64",
        "chrome-headless-shell-mac-x64",
        "chrome-linux",
        "chrome-headless-shell-linux64",
      ]) {
        const candidate = join(root, name, platform, "chrome-headless-shell");
        if (existsSync(candidate)) return { executablePath: candidate, headless: true };
      }
    }
  throw new Error(
    "No Chromium executable found. Set CHROMIUM_PATH or run playwright install chromium.",
  );
}
