import layout from "../../../scripts/app-source-layout.json";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

export const repositoryRoot = process.cwd();

const appRoots = Object.entries(layout).map(([source, target]) => ({
  logical: `src/${source}`,
  physical: resolve(repositoryRoot, "../misty-apps/apps", target),
}));

export function sourcePath(path: string): string {
  const match = appRoots.find(
    ({ logical }) =>
      path === logical || path.startsWith(`${logical}/`) || path === `${logical}.tsx`,
  );
  return match ? match.physical + path.slice(match.logical.length) : resolve(repositoryRoot, path);
}

export function repositoryPath(path: string): string {
  const match = appRoots.find(
    ({ physical }) =>
      path === physical || path.startsWith(`${physical}/`) || path === `${physical}.tsx`,
  );
  return match
    ? match.logical + path.slice(match.physical.length)
    : relative(repositoryRoot, path).split("\\").join("/");
}

export function lineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  return text.length === 0 ? 0 : text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

export function walk(
  root: string,
  extensions: ReadonlySet<string>,
  ignoredDirectories = new Set(["build", "dist", "gen", "node_modules", "target"]),
): string[] {
  const directory = sourcePath(root);
  if (!existsSync(directory)) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || (entry.isDirectory() && ignoredDirectories.has(entry.name))) {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      paths.push(...walk(repositoryPath(path), extensions, ignoredDirectories));
    else if (entry.isFile() && extensions.has(extname(entry.name))) paths.push(path);
  }
  if (root === "src") {
    for (const { logical, physical } of appRoots) {
      if (existsSync(physical)) paths.push(...walk(logical, extensions, ignoredDirectories));
      else if (existsSync(`${physical}.tsx`) && extensions.has(".tsx"))
        paths.push(`${physical}.tsx`);
    }
  }
  return paths;
}
