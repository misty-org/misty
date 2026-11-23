import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const guidePath = `${process.cwd()}/src-tauri/features/agents/runs/local_prompt/companion_misty_guide.md`;
const hasGuide = existsSync(guidePath);
const guide = hasGuide ? readFileSync(guidePath, "utf8") : "";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe.skipIf(!hasGuide)("the companion's Misty guide", () => {
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
    const registry = sources(`${process.cwd()}/src/shared/shortcuts`)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const keyName: Record<string, string> = { ",": "Comma", "`": "Grave" };
    const shortcuts = [...guide.matchAll(/Cmd\+(?:[A-Z][a-z]*\+)*[^\s.,)]+|Cmd\+[,`]/g)].map(
      (match) => match[0].replace(/[,`]$/, (key) => keyName[key]),
    );
    expect(shortcuts.length).toBeGreaterThan(5);
    expect(shortcuts.filter((shortcut) => !registry.includes(`"${shortcut}"`))).toEqual([]);
  });
});
