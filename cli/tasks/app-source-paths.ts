import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const appSourceLayout = JSON.parse(
  readFileSync(new URL("./app-source-layout.json", import.meta.url), "utf8"),
);
export function appSourceRoot(hostRoot) {
  return resolve(hostRoot, "apps");
}
export function appSourceAliases(hostRoot, appsRoot = appSourceRoot(hostRoot)) {
  return Object.fromEntries(
    Object.entries(appSourceLayout).map(([source, target]) => [
      `@/${source}`,
      resolve(appsRoot, target),
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
        !importer?.startsWith(resolve(appsRoot) + "/") ||
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
