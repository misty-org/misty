import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repositoryPath, repositoryRoot, sourcePath, walk } from "./repositoryPolicy";
import {
  collectUiViolations,
  nextUiBaseline,
  parseUiBaseline,
  uiExceptionsBaselinePath,
  uiRuleGuidance,
  uiRuleIds,
  uiViolationCounts,
  type UiBaseline,
  type UiRuleId,
} from "./uiRules";

const extensions = new Set([".ts", ".tsx"]);
const uiImplementationRoots = ["src/shared/ui/"];
/** Files whose job is defining custom properties that stylesheets read. */
const customPropertyDefinitionOwners = new Set([
  // Runtime geometry and user-selected group colors feed the shell stylesheets.
  "src/app/layouts/DesktopLayout/dockingGeometry.ts",
  "src/app/layouts/DesktopLayout/MistyTabGroups.tsx",
  // The theme store writes the palette every surface reads.
  "src/features/settings/preferences/appTheme.ts",
  // The companion's runtime size feeds four rules in cursorCompanion.css.
  "src/features/agents/tutor/cursor/CursorOverlayMarkup.tsx",
  // Dragged widths: the chat panel and the agent sidebar restyle only their column.
  "src/features/agents/panel/MistyPanelDock.tsx",
  "src/features/agents/methods/AgentWorkspaceFrame.tsx",
]);
/** The cursor companion rides the pointer and rotates every frame; it is never pixel-aligned. */
const pointerFollowingFiles = new Set([
  "src/features/agents/tutor/cursor/cursorOverlayLoop.ts",
  "src/features/agents/tutor/cursor/cursorCompanion.css",
]);
const allowedSourceRoots = new Set([
  "api",
  "app",
  "features",
  "native",
  "shared",
  "styles",
  "tests",
]);

describe("UI architecture contract", () => {
  it("keeps behavior tests colocated with their source", () => {
    const failures = walk("src", extensions)
      .map(repositoryPath)
      .filter((path) => path.includes("/__tests__/"));
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the frontend inside the documented top-level layers", () => {
    const failures = walk("src", extensions)
      .map(repositoryPath)
      .filter((path) => path !== "src/vite-env.d.ts")
      .map((path) => path.split("/")[1])
      .filter((root) => root && !allowedSourceRoots.has(root));
    expect([...new Set(failures)], failures.join("\n")).toEqual([]);
  });

  it("imports shared UI only through its barrel", () => {
    const failures = walk("src", extensions)
      .map(repositoryPath)
      .filter((path) => !uiImplementationRoots.some((root) => path.startsWith(root)))
      .filter((path) =>
        /from\s+["'](?:@\/shared\/ui\/|(?:\.\.?\/)+(?:[\w-]+\/)*shared\/ui\/)/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => `${path}: import from "@/shared/ui"`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("names component files in PascalCase", () => {
    const failures = walk("src", new Set([".tsx"]))
      .map(repositoryPath)
      .filter((path) => !/\.test\.tsx$/.test(path))
      // The single settings navigation registry keeps its stable path.
      .filter((path) => path !== "src/features/settings/settingsRegistry.tsx")
      .filter((path) => {
        const name = path
          .split("/")
          .pop()!
          .replace(/\.tsx$/, "");
        return !/^[A-Z]/.test(name) && !/^[a-z]+$/.test(name) && !/^use[A-Z]/.test(name);
      });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps shared primitives at the UI boundary", () => {
    const failures: string[] = [];
    for (const path of walk("src", extensions)) {
      const relative = repositoryPath(path);
      if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) continue;
      const text = readFileSync(path, "utf8");
      if (
        !uiImplementationRoots.some((root) => relative.startsWith(root)) &&
        /from\s+["'](?:@radix-ui\/|radix-ui["'])/.test(text)
      ) {
        failures.push(`${relative}: import Radix only inside src/shared/ui`);
      }
      // Reading a token with var() inside a Tailwind class is fine; defining new custom
      // properties inline is where styling escapes the design system.
      if (
        !uiImplementationRoots.some((root) => relative.startsWith(root)) &&
        !customPropertyDefinitionOwners.has(relative) &&
        /["']--[a-z][a-z0-9-]*["']\s*:/.test(text)
      ) {
        failures.push(`${relative}: use Tailwind classes instead of CSS custom properties`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // A -50% translate lands odd-sized surfaces on a half pixel, which blurs their text on 1x
  // displays. Center with layout instead (inset-0 m-auto, inset-x-0 mx-auto w-fit), which snaps.
  // Shared UI is included: dialogs are where this showed up first.
  it("centers surfaces with layout, not half-size translates", () => {
    const failures: string[] = [];
    for (const path of walk("src", new Set([...extensions, ".css"]))) {
      const relative = repositoryPath(path);
      if (/\.test\.tsx?$/.test(relative) || pointerFollowingFiles.has(relative)) continue;
      if (/translate-[xy]-1\/2|translate[XY]?\(\s*-?50%/.test(readFileSync(path, "utf8"))) {
        failures.push(`${relative}: center with inset + auto margins instead of translate 50%`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("composes shared UI everywhere, with counts that only fall", () => {
    const baseline = parseUiBaseline(
      JSON.parse(readFileSync(sourcePath(uiExceptionsBaselinePath), "utf8")),
    );
    const known = new Set(baseline.rules);
    const fresh = uiRuleIds.filter((id) => !known.has(id));
    const failures = fresh.map(
      (id) => `${id}: new rule; record its starting point with --write-baseline`,
    );
    const found = collectUiViolations(repositoryRoot);
    const paths = new Set([...Object.keys(found), ...Object.keys(baseline.files)]);
    for (const path of [...paths].sort()) {
      const counts = found[path] ?? {};
      const allowed = baseline.files[path] ?? {};
      if (!existsSync(sourcePath(path))) {
        failures.push(`${path}: gone; remove it from the baseline`);
        continue;
      }
      for (const id of new Set([...Object.keys(counts), ...Object.keys(allowed)])) {
        if (!uiRuleIds.includes(id as UiRuleId)) {
          failures.push(`${path}: ${id} is no longer a rule; regenerate the baseline`);
          continue;
        }
        if (fresh.includes(id as UiRuleId)) continue;
        const now = counts[id as UiRuleId] ?? 0;
        const before = allowed[id] ?? 0;
        if (now > before) {
          failures.push(
            `${path}: ${uiRuleGuidance(id as UiRuleId)} [${id}: ${now}, baseline ${before}]`,
          );
        } else if (now === 0) {
          // A lower count passes, so work in progress isn't blocked; --write-baseline lowers it.
          failures.push(`${path}: fixed ${id}; remove it with --write-baseline`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("UI rules", () => {
  const count = (path: string, text: string) => uiViolationCounts(path, text);
  const feature = "src/features/example/Example.tsx";

  it("counts every hit, not just whether a file has one", () => {
    expect(count(feature, `<p className="truncate" /><p className="w-full truncate" />`)).toEqual({
      ellipsis: 2,
    });
  });

  it("reads multi-line tags with arrows and nested elements in their attributes", () => {
    const text = `
      <Button
        onClick={() => go(a > b)}
        icon={<Mark title="inner" />}
        variant={busy ? "ghost" : "quiet"}
        size="xs"
      >
        Go
      </Button>`;
    expect(count(feature, text)).toMatchObject({
      "legacy-button-variant": 1,
      "legacy-button-size": 1,
    });
    // The nested Mark is not a component that forwards title.
    expect(count(feature, text)["native-title"]).toBeUndefined();
  });

  it("flags the system title on elements and on components that forward it", () => {
    expect(count(feature, `<span title="Full name">x</span>`)["native-title"]).toBe(1);
    expect(count(feature, `<Pressable\n  title="Open"\n/>`)["native-title"]).toBe(1);
    expect(count(feature, `<iframe title="Preview" />`)["native-title"]).toBeUndefined();
    expect(count(feature, `<Dialog title="Rename" />`)["native-title"]).toBeUndefined();
  });

  it("allows the new Button and IconButton API", () => {
    const text = `
      <Button variant="primary" size="lg">Save</Button>
      <IconButton label="Close" variant="overlay" size="sm"><X /></IconButton>
      <MenuTrigger label="Model" variant="quiet" size="md" />`;
    expect(count(feature, text)).toEqual({});
    expect(count(feature, `<Button variant="overlay">x</Button>`)).toEqual({
      "legacy-button-variant": 1,
    });
    expect(count(feature, `<IconButton label="x" size="lg"><X /></IconButton>`)).toEqual({
      "legacy-button-size": 1,
    });
  });

  it("keeps menu rows shared, with icons only where they tell rows apart", () => {
    expect(count(feature, `<MenuItem label="Rename" onSelect={() => rename()} />`)).toEqual({});
    expect(count(feature, `<MenuItem icon={Pencil} label="Rename" />`)).toEqual({});
    expect(count(feature, `<DropdownMenuItem onSelect={go}>Go</DropdownMenuItem>`)).toEqual({
      "raw-menu-row": 1,
    });
    const repeated = `{models.map((model) => (
      <MenuRadioItem key={model.id} icon={Cpu} value={model.id} label={model.id} />
    ))}`;
    expect(count(feature, repeated)).toEqual({ "repeated-menu-icon": 1 });
    const own = `{sorts.map((sort) => (
      <MenuRadioItem key={sort.value} icon={sort.icon} value={sort.value} label={sort.label} />
    ))}`;
    expect(count(feature, own)).toEqual({});
  });

  it("finds bars that wrap, not chip clouds", () => {
    expect(count(feature, `<div className="flex flex-wrap items-center gap-2" />`)).toEqual({
      "ragged-wrap": 1,
    });
    expect(count(feature, `<Toolbar wrap label="Tools" />`)).toEqual({ "ragged-wrap": 1 });
    expect(count(feature, `<div className="mt-2 flex flex-wrap gap-1.5" />`)).toEqual({});
  });

  it("keeps monospace to code views and DuckDuckGo to the search-site recognizers", () => {
    expect(count(feature, `<code className="font-mono">{id}</code>`)).toEqual({
      "mono-outside-code": 1,
    });
    const editor = "src/features/agents/context-panel/editor/Editor.tsx";
    expect(count(editor, `<pre className="font-mono" />`)).toEqual({});
    expect(count(feature, `const font = "var(--font-mono)";`)).toEqual({});
    const search = "src/features/agents/context-panel/search.ts";
    expect(count(search, `const home = "https://duckduckgo.com/";`)).toEqual({ duckduckgo: 1 });
    const recognizer = "src/features/agents/programs/searchRedirect.ts";
    expect(count(recognizer, `host.endsWith("duckduckgo.com")`)).toEqual({});
  });

  it("finds loading text and loose status words", () => {
    expect(count(feature, `{busy ? "Saving…" : "Save"}`)).toEqual({ "loading-text": 1 });
    expect(count(feature, `<p>Loading...</p>`)).toEqual({ "loading-text": 1 });
    expect(count(feature, `<span className="x">Saved</span>`)).toEqual({ "status-word": 1 });
    expect(count(feature, `<Button onClick={close}>Done</Button>`)).toEqual({});
  });

  it("finds one-off pixels, raw colors and leading row icons", () => {
    expect(count(feature, `<div className="w-[320px] md:max-w-[480px] h-8" />`)).toEqual({
      "arbitrary-px": 2,
    });
    expect(count(feature, `<p className="text-cream-muted bg-charcoal-card/50" />`)).toEqual({
      "raw-color-class": 2,
    });
    const row = `import { Folder } from "lucide-react";
      <ListRow>
        <Folder aria-hidden />
        <ListRowButton>Docs</ListRowButton>
      </ListRow>`;
    expect(count(feature, row)).toEqual({ "leading-icon-in-list-row": 1 });
  });

  it("ignores prose in comments", () => {
    expect(count(feature, `// never truncate here\n/* line-clamp-2 */\nconst a = 1;`)).toEqual({});
  });

  it("applies the shared subset inside src/shared/ui", () => {
    const shared = "src/shared/ui/controls/Example.tsx";
    const text = `<span title="x" className="truncate w-[13px] text-cream bg-[#fff] text-[13px]" />`;
    expect(count(shared, text)).toEqual({
      "native-title": 1,
      ellipsis: 1,
      "arbitrary-px": 1,
      "hex-color": 1,
      "font-size-literal": 1,
    });
  });

  it("checks feature stylesheets", () => {
    const css = `
      /* font-size: 13px in a comment doesn't count */
      #root { color: var(--x); }
      .a { font-size: 13px; color: #fff; text-overflow: ellipsis; z-index: 5; }
      .b { font-size: var(--text-meta); font-family: var(--font-mono); }`;
    expect(count("src/features/example/example.css", css)).toEqual({
      "feature-stylesheet": 1,
      "css-font-size": 1,
      "css-hex": 1,
      "css-ellipsis": 1,
      "css-mono": 1,
      "css-z": 1,
    });
    expect(count("src/styles/theme.css", css)).toEqual({});
    expect(count("src/shared/ui/feedback/example.css", css)).toEqual({});
  });
});

describe("UI baseline updates", () => {
  const known = (files: UiBaseline["files"]): UiBaseline => ({ rules: [...uiRuleIds], files });

  it("lowers counts and drops fixed pairs", () => {
    const update = nextUiBaseline(known({ "src/a.tsx": { ellipsis: 3, "arbitrary-px": 1 } }), {
      "src/a.tsx": { ellipsis: 2 },
    });
    expect(update.baseline.files).toEqual({ "src/a.tsx": { ellipsis: 2 } });
    expect(update.refused).toEqual([]);
    expect(update.lowered).toHaveLength(2);
  });

  it("never adds a pair or raises a count for a rule it already knows", () => {
    const update = nextUiBaseline(known({ "src/a.tsx": { ellipsis: 1 } }), {
      "src/a.tsx": { ellipsis: 4 },
      "src/b.tsx": { "native-title": 1 },
    });
    expect(update.baseline.files).toEqual({ "src/a.tsx": { ellipsis: 1 } });
    expect(update.refused).toEqual([
      "src/a.tsx: ellipsis 4 (baseline 1)",
      "src/b.tsx: native-title 1 (baseline 0)",
    ]);
  });

  it("records a rule new in this run from today's code", () => {
    const previous: UiBaseline = {
      rules: uiRuleIds.filter((id) => id !== "ellipsis"),
      files: {},
    };
    const update = nextUiBaseline(previous, {
      "src/a.tsx": { ellipsis: 2, "native-title": 1 },
    });
    expect(update.newRules).toEqual({ ellipsis: 2 });
    expect(update.baseline.files).toEqual({ "src/a.tsx": { ellipsis: 2 } });
    expect(update.baseline.rules).toEqual(uiRuleIds);
    expect(update.refused).toEqual(["src/a.tsx: native-title 1 (baseline 0)"]);
  });
});
