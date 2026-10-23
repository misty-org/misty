import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * The companion's Misty guide (embedded by the server) names controls in
 * quotes and shortcuts as Cmd+…. Each must still exist in the app, so the guide
 * cannot silently drift from the interface it describes.
 */
const guide = readFileSync(
  `${process.cwd()}/server/internal/platform/httpapi/companion_misty_guide.md`,
  "utf8",
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

it("names only controls that exist in the app", () => {
  const app = sources(`${process.cwd()}/src`)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const names = [...guide.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  expect(names.length).toBeGreaterThan(20);
  const inApp = (name: string) =>
    app.includes(`"${name}"`) ||
    new RegExp(`>\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*<`).test(app);
  expect(names.filter((name) => !inApp(name))).toEqual([]);
});

it("lists only shortcuts that are bound", () => {
  const registry = [
    "registry.ts",
    "workspaceCommands.ts",
    "browserCommands.ts",
    "browserFeatureCommands.ts",
  ]
    .map((file) => readFileSync(`${process.cwd()}/src/features/shortcuts/${file}`, "utf8"))
    .join("\n");
  const keyName: Record<string, string> = { ",": "Comma", "`": "Grave" };
  const shortcuts = [...guide.matchAll(/Cmd\+(?:[A-Z][a-z]*\+)*[^\s.,)]+|Cmd\+[,`]/g)].map(
    (match) => match[0].replace(/[,`]$/, (key) => keyName[key]),
  );
  expect(shortcuts.length).toBeGreaterThan(5);
  expect(shortcuts.filter((shortcut) => !registry.includes(`"${shortcut}"`))).toEqual([]);
});
