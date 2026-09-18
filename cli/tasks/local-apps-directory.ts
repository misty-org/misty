import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Runtime packages default to this checkout; explicit release candidates remain supported. */
export function localAppsDirectory(configured: string | undefined, cwd: string, home = homedir()): string {
  const local = resolve(cwd, "apps");
  if (configured?.trim()) {
    const value = configured.trim();
    const directory = resolve(cwd, value.startsWith("~/") ? resolve(home, value.slice(2)) : value);
    const retired = [resolve(cwd, "../misty-apps"), resolve(home, "misty-org/misty-apps")];
    if (retired.includes(directory) && existsSync(resolve(local, "catalog.json"))) return local;
    if (!existsSync(resolve(directory, "catalog.json"))) throw new Error(`Misty Apps catalog not found in ${directory}`);
    return directory;
  }
  return existsSync(resolve(local, "catalog.json")) ? local : "";
}
