import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

export const repositoryRoot = process.cwd();

export function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).split("\\").join("/");
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
  const directory = resolve(repositoryRoot, root);
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
  return paths;
}
