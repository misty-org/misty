import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * App-wide UI rules. Code outside src/shared/ui composes shared components instead of
 * restyling or re-implementing them. Existing debt is listed in ui-exceptions-baseline.json,
 * which may only shrink.
 */
export const uiRules = {
  "raw-control": {
    pattern: /<(?:button|input|select|textarea)\b/,
    guidance: "use Button, IconButton, Input, Select, or Textarea from @/shared/ui",
  },
  "full-screen-overlay": {
    pattern: /\bfixed\s+inset-0\b/,
    guidance: "use Dialog, Sheet, or WorkspaceOverlay",
  },
  portal: {
    pattern: /\bcreatePortal\s*\(/,
    guidance: "let the overlay primitive own its portal",
  },
  "z-index-literal": {
    pattern: /\bz-\[\d{4,}\]/,
    guidance: "use a named layer token",
  },
  "popup-class": {
    pattern:
      /\b(?:menu(?:Item|List|Label|Shortcut|Content|Indicator|IndicatorItem|Separator)Class|popup(?:Surface|Motion)Class|popoverContentClass)\b/,
    guidance: "build rows with MenuItem inside a DropdownMenu instead of popup class strings",
  },
  "popover-menu": {
    pattern: /<PopoverContent\b(?:(?!<\/PopoverContent>)[\s\S])*?role="menu"/,
    guidance: "a popup that lists actions is a DropdownMenu, not a Popover",
  },
  "manual-menu-chevron": {
    pattern:
      /<(DropdownMenuTrigger|PopoverTrigger)\b(?:(?!<\/\1>)[\s\S])*?<Chevron(?:Down|Up|sUpDown)\b/,
    guidance: "use MenuTrigger; it owns the chevron",
  },
  "popup-animation-off": {
    // motion-reduce:animate-none is an accessibility preference, not a disabled popup.
    pattern: /(?<!motion-reduce:)\banimate-none\b/,
    guidance: "popups keep the shared open/close motion",
  },
  "popup-surface-override": {
    pattern: new RegExp(
      "<(?:DropdownMenuContent|DropdownMenuSubContent|ContextMenuContent|ContextMenuSubContent" +
        "|PopoverContent|SelectContent)\\b[^>]*className=[^>]*\\b(?:bg-|rounded-|shadow-|ring-|border-)",
    ),
    guidance: "popup surfaces are fixed; set width, height, or alignment only",
  },
  "icon-only-button": {
    pattern: /<Button\b(?:[^>]|=>)*?\bsize="icon/,
    guidance: "use IconButton for icon-only buttons",
  },
  "button-restyle": {
    // Surfaces whose look is their content (cards, rows, tabs) use Pressable instead.
    pattern:
      /<(?:Button|IconButton)\b(?:[^>]|=>)*?className=(?:"|\{[^}]*")[^"]*(?<![\w[-])(?:[a-z-]+:)*(?:bg-|rounded|shadow-|ring-|border-(?!0\b))/,
    guidance: "pick a Button or IconButton variant, size, or shape; use Pressable for surfaces",
  },
  "unsized-button": {
    pattern: /<Button\b(?![^>]*variant="link")(?:[^>]|=>)*?\bsize="none"/,
    guidance: "use a Button size, IconButton, or Pressable; only links drop the size",
  },
  "hand-rolled-spinner": {
    pattern: /<(?:Loader2|LoaderCircle)\b[^>]*animate-spin/,
    guidance: "use Spinner",
  },
  "hex-color": {
    pattern: /-\[#[0-9a-fA-F]{3,8}\]/,
    guidance: "use theme color tokens instead of hex values",
  },
} as const;

export type UiRuleId = keyof typeof uiRules;

/** Theme palettes are data, not styling, and may spell out hex colors. */
const themeData = /(?:settings\/store\/appTheme)\.ts$/;

export function uiViolations(path: string, text: string): UiRuleId[] {
  return (Object.keys(uiRules) as UiRuleId[]).filter((id) => {
    if (id === "hex-color" && themeData.test(path)) return false;
    return uiRules[id].pattern.test(text);
  });
}

export function isUiRuleSubject(path: string): boolean {
  return (
    /^src\/.*\.tsx?$/.test(path) &&
    !path.startsWith("src/shared/ui/") &&
    !path.startsWith("src/tests/") &&
    !/\.test\.tsx?$/.test(path) &&
    !path.endsWith(".d.ts")
  );
}

export const uiExceptionsBaselinePath =
  "src/tests/architecture/fixtures/ui-exceptions-baseline.json";

function collect(root: string, directory: string, found: Record<string, UiRuleId[]>) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) collect(root, absolute, found);
    const path = relative(root, absolute).split("\\").join("/");
    if (!entry.isFile() || !isUiRuleSubject(path)) continue;
    const violations = uiViolations(path, readFileSync(absolute, "utf8"));
    if (violations.length) found[path] = violations;
  }
  return found;
}

/** Regenerate the baseline: `node src/tests/architecture/uiRules.ts --write-baseline` from the repo root. */
if (process.argv.includes("--write-baseline")) {
  const root = process.cwd();
  const found = collect(root, join(root, "src"), {});
  const sorted = Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(root, uiExceptionsBaselinePath), `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`${Object.keys(sorted).length} files with UI exceptions`);
}
