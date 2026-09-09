import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export function localAppsDirectory(configured, cwd, home = homedir()) {
  if (configured?.trim()) {
    const value = configured.trim();
    const directory = resolve(cwd, value.startsWith("~/") ? resolve(home, value.slice(2)) : value);
    if (existsSync(resolve(directory, "catalog.json")) && existsSync(resolve(dirname(directory), "package.json"))) return dirname(directory);
    if (!existsSync(resolve(directory, "apps/catalog.json")))
      throw new Error(`Misty Apps catalog not found in ${directory}`);
    return directory;
  }
  return [resolve(home, "misty-org/misty-apps"), resolve(cwd, "../misty-apps")]
    .find((directory) => existsSync(resolve(directory, "apps/catalog.json"))) ?? "";
}
