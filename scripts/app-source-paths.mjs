import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadAppEnv } from "./app-env.mjs";
import { localAppsDirectory } from "./local-apps-directory.mjs";

export const appSourceLayout = JSON.parse(
  readFileSync(new URL("./app-source-layout.json", import.meta.url), "utf8"),
);
export function appSourceRoot(hostRoot) {
  const env = loadAppEnv(hostRoot);
  return (
    env.MISTY_APPS_ROOT ||
    localAppsDirectory(env.VITE_MISTY_APPS_DIRECTORY ?? env.MISTY_APPS_DIRECTORY, hostRoot) ||
    resolve(hostRoot, "../misty-apps")
  );
}
export function appSourceAliases(hostRoot, appsRoot = appSourceRoot(hostRoot)) {
  return Object.fromEntries(
    Object.entries(appSourceLayout).map(([source, target]) => [
      `@/${source}`,
      resolve(appsRoot, "apps", target),
    ]),
  );
}
// App components share the Host's dependency versions (including React 19).
export function appSourceDependencies(hostRoot, appsRoot = appSourceRoot(hostRoot)) {
  return {
    name: "misty-app-source-dependencies",
    enforce: "pre",
    async resolveId(source, importer) {
      if (
        !importer?.startsWith(resolve(appsRoot, "apps") + "/") ||
        source.startsWith(".") ||
        source.startsWith("/") ||
        source.startsWith("\0") ||
        source.startsWith("@/") ||
        source.startsWith("@misty/legacy-") ||
        source === "@misty/browser-view"
      )
        return;
      return this.resolve(source, resolve(hostRoot, "src/app-dependency.ts"), { skipSelf: true });
    },
  };
}
