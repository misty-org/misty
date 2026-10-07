import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
export const output = join(root, "output");
export const PROMO_URL = process.env.PROMO_URL ?? "http://127.0.0.1:5292";

/** CHROMIUM_PATH, or the newest Playwright headless shell in the user cache. */
export function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  const builds = existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse() : [];
  for (const build of builds)
    for (const platform of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux64"]) {
      const candidate = join(cache, build, platform, "chrome-headless-shell");
      if (existsSync(candidate)) return candidate;
    }
  throw new Error("No Chromium found. Set CHROMIUM_PATH or run `npx playwright-core install chromium-headless-shell`.");
}
