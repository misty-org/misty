import {
  countLeadingRowIcons,
  countLegacySizes,
  countLegacyVariants,
  countMenuRowsWithoutIcon,
  countNativeTitles,
  countRaggedWraps,
  countStatusWords,
  type Counter,
} from "./uiRuleCounters.ts";

/**
 * Every UI rule: what it catches, where it doesn't apply, and what to use instead. uiRules.ts
 * decides which files get which rules and keeps the baseline.
 *
 * Runs under plain Node with uiRules.ts, so it imports nothing but Node itself.
 */

export interface UiRule {
  /** What to do instead, naming the shared component. Shown when the rule fails. */
  guidance: string;
  /** Counted by its matches. */
  pattern?: RegExp;
  /** Counted by code, for rules a regex can't say (tags and their attributes). */
  count?: Counter;
  /** Paths the rule leaves alone, each with its reason next to it. */
  allow?: readonly RegExp[];
  /** Only .tsx files: rules that read JSX tags. */
  jsx?: boolean;
}

/**
 * A Tailwind class token in a string: preceded by a quote, a space or a brace, followed by one of
 * those, with any variant prefixes (`hover:`, `md:`, `[&_svg]:`) and the `!` modifier. Prose and
 * function names (`truncate(text)`) don't match.
 */
function classToken(body: string): RegExp {
  return new RegExp(
    `(?<=["'\`\\s{])(?:[a-z0-9-]+:|\\[[^\\]\\s"'\`]+\\]:)*!?(?:${body})(?=["'\`\\s}])`,
    "g",
  );
}

// ---------------------------------------------------------------------------------------------
// Path allowlists, each with its reason.

/** Monospace belongs to code itself: the editor, the terminal, diffs and markdown code blocks. */
const codeViews = [
  /^src\/features\/agents\/context-panel\/editor\//,
  /^src\/features\/agents\/context-panel\/terminal\//,
  /^src\/features\/agents\/context-panel\/git\/DiffView\.tsx$/,
  /^src\/features\/agents\/runs\/markdown\//,
  /^src\/shared\/lib\/terminal\//,
  // A text file's own contents, shown as the file.
  /^src\/features\/spaces\/library\/library-primitives\/LibraryTextPreview\.tsx$/,
  /^src\/features\/files\/preview\/EmbeddedUniversalPreviewView\.tsx$/,
] as const;

/** Stylesheets for code itself. */
const codeStylesheets = [
  /^src\/features\/agents\/context-panel\/terminal\/terminal\.css$/,
  /^src\/features\/agents\/runs\/markdown\//,
  /^src\/features\/spaces\/journal\/notes\/components\/noteTiptapEditor\.css$/,
] as const;

/** Recognizing a search site's redirect links is reading them, not searching with them. */
const searchSiteRecognizers = [/^src\/features\/agents\/programs\/searchRedirect\.ts$/] as const;

/** Theme palettes are data, not styling, and may spell out hex colors. */
const themeData = [/^src\/features\/settings\/preferences\/appTheme\.ts$/] as const;

// ---------------------------------------------------------------------------------------------
// The rules.

/** Rules for every .ts and .tsx file outside src/shared/ui and src/tests. */
export const uiRules = {
  "raw-control": {
    pattern: /<(?:button|input|select|textarea)\b/g,
    guidance: "use Button, IconButton, Input, Select, or Textarea from @/shared/ui",
  },
  "full-screen-overlay": {
    pattern: /\bfixed\s+inset-0\b/g,
    guidance: "use Dialog, Sheet, or WorkspaceOverlay",
  },
  portal: {
    pattern: /\bcreatePortal\s*\(/g,
    guidance: "let the overlay primitive own its portal",
  },
  "z-index-literal": {
    pattern: /\bz-\[\d{4,}\]/g,
    guidance: "use a named layer token",
  },
  "popup-class": {
    pattern: new RegExp(
      "\\b(?:menu(?:Item|List|Label|Shortcut|Content|Indicator|IndicatorItem|Separator)Class" +
        "|popup(?:Surface|Motion)Class|popoverContentClass)\\b",
      "g",
    ),
    guidance: "build rows with MenuItem inside a DropdownMenu instead of popup class strings",
  },
  "popover-menu": {
    pattern: /<PopoverContent\b(?:(?!<\/PopoverContent>)[\s\S])*?role="menu"/g,
    guidance: "a popup that lists actions is a DropdownMenu, not a Popover",
  },
  "manual-menu-chevron": {
    pattern:
      /<(DropdownMenuTrigger|PopoverTrigger)\b(?:(?!<\/\1>)[\s\S])*?<Chevron(?:Down|Up|sUpDown)\b/g,
    guidance: "use MenuTrigger; it owns the chevron",
  },
  "popup-animation-off": {
    // motion-reduce:animate-none is an accessibility preference, not a disabled popup.
    pattern: /(?<!motion-reduce:)\banimate-none\b/g,
    guidance: "popups keep the shared open/close motion",
  },
  "popup-surface-override": {
    pattern: new RegExp(
      "<(?:DropdownMenuContent|DropdownMenuSubContent|ContextMenuContent|ContextMenuSubContent" +
        "|PopoverContent|SelectContent)\\b[^>]*className=[^>]*\\b(?:bg-|rounded-|shadow-|ring-|border-)",
      "g",
    ),
    guidance: "popup surfaces are fixed; set width, height, or alignment only",
  },
  "icon-only-button": {
    pattern: /<Button\b(?:[^>]|=>)*?\bsize="icon/g,
    guidance: "use IconButton (label, icon as children, size sm or md) for icon-only buttons",
  },
  "button-restyle": {
    // Surfaces whose look is their content (cards, rows, tabs) use Pressable instead.
    pattern: new RegExp(
      '<(?:Button|IconButton)\\b(?:[^>]|=>)*?className=(?:"|\\{[^}]*")' +
        '[^"]*(?<![\\w[-])(?:[a-z-]+:)*(?:bg-|rounded|shadow-|ring-|border-(?!0\\b))',
      "g",
    ),
    guidance: "pick a Button or IconButton variant and size; use Pressable for surfaces",
  },
  "unsized-button": {
    pattern: /<Button\b(?![^>]*variant="link")(?:[^>]|=>)*?\bsize="none"/g,
    guidance: "use a Button size (sm 24, md 32, lg 36), IconButton, or Pressable",
  },
  "hand-rolled-spinner": {
    pattern: /<(?:Loader2|LoaderCircle)\b[^>]*animate-spin/g,
    guidance: "use Spinner, or the Button's loading prop",
  },
  "all-caps": {
    // A class token inside a string on one line, so prose that says "uppercase" is fine.
    pattern: /["'`](?:[^"'`\n]*\s)?(?:[a-z-]+:)*(?:uppercase|small-caps)(?=[\s"'`])/g,
    guidance: "write sentence case; keep only real acronyms in capitals",
  },
  "font-size-literal": {
    pattern: /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g,
    guidance:
      "use a type role: text-micro 11, caption 12, meta 13, control 14, body 15, page 16, " +
      "title 18, display 24 (or Text size=…)",
  },
  "hex-color": {
    pattern: /-\[#[0-9a-fA-F]{3,8}\]/g,
    allow: themeData,
    guidance: "use theme color tokens instead of hex values",
  },
  ellipsis: {
    pattern: classToken("truncate|text-ellipsis|line-clamp-(?:\\d+|\\[\\d+\\])"),
    // The deprecated shim that makes `truncate` fade selects on those class names until it goes.
    allow: [/^src\/shared\/ui\/layout\/overflowFade\.ts$/],
    guidance: "long text fades, never an ellipsis: use OverflowFadeText or Text",
  },
  "native-title": {
    count: countNativeTitles,
    jsx: true,
    guidance:
      "never the system title: wrap it in Tooltip, give an IconButton its label, or let " +
      "OverflowFadeText show the whole text",
  },
  "tooltip-off": {
    pattern: /\btooltip=\{false\}/g,
    guidance: "every icon button has a tooltip: drop tooltip={false}; IconButton's label is it",
  },
  "ragged-wrap": {
    count: countRaggedWraps,
    jsx: true,
    guidance:
      "nothing wraps into ragged rows: put the controls in an ActionBar, which turns labels " +
      "into icons, fades its shrink item, then folds low-priority items into ⋯",
  },
  "mono-outside-code": {
    pattern: new RegExp(
      `${classToken("font-mono").source}|${classToken("font-\\[[^\\]\\s]*mono[^\\]\\s]*\\]").source}` +
        `|fontFamily:\\s*["'\`][^"'\`]*mono`,
      "g",
    ),
    allow: codeViews,
    guidance:
      "monospace only inside code itself (the editor, diffs, the terminal, code blocks), never " +
      "for paths, IDs, URLs, model names or shortcuts: use Text or OverflowFadeText",
  },
  "loading-text": {
    pattern: new RegExp(
      "(?<=>)[^<>{}]*?\\b[A-Z][a-z]+ing\\b[^<>{}\\n]{0,60}?(?:…|\\.\\.\\.)\\s*(?=<)" +
        "|[\"'`][A-Z][a-z]+ing\\b[^\"'`\\n]{0,60}?(?:…|\\.\\.\\.)[\"'`]",
      "g",
    ),
    guidance:
      "never loading text: first loads use a Skeleton shaped like the content (ListRowSkeleton, " +
      "SkeletonList), and work on a click is the Button's loading prop",
  },
  "status-word": {
    count: countStatusWords,
    guidance:
      "no loose status words: changes save themselves, and a failure shows next to what " +
      "failed (FieldError, or notify with tone danger)",
  },
  "legacy-button-variant": {
    count: countLegacyVariants,
    guidance:
      "Button and IconButton variants are primary, secondary, quiet and danger (IconButton also " +
      "overlay): default and outline → secondary, ghost, toolbar and link → quiet, destructive " +
      "→ danger, chip → ChoiceGroup or FilterChip. An old variant's size sm is 32: make it md",
  },
  "legacy-button-size": {
    count: countLegacySizes,
    jsx: true,
    guidance:
      "Button sizes are sm 24, md 32 and lg 36 (xs → sm, default and chip → md); IconButton " +
      "sizes are sm 24 and md 32 (2xs and xs → sm, lg → md)",
  },
  "menu-item-without-icon": {
    count: countMenuRowsWithoutIcon,
    jsx: true,
    guidance:
      "every menu row is a MenuItem, MenuCheckItem, MenuRadioItem or MenuSubmenu with a 16px " +
      "icon (icon={Pencil}); never a raw DropdownMenu or ContextMenu item",
  },
  "leading-icon-in-list-row": {
    count: countLeadingRowIcons,
    jsx: true,
    guidance:
      "list rows start with their text: use ListRow with label, state and menu, and no " +
      "leading icon",
  },
  duckduckgo: {
    pattern: /duckduckgo/gi,
    allow: searchSiteRecognizers,
    guidance: "the agent browser opens on a blank page and searches with Google, never DuckDuckGo",
  },
  "arbitrary-px": {
    pattern: classToken(
      "-?(?:h|w|min-h|min-w|max-h|max-w|size|gap(?:-[xy])?|p[trblxy]?|m[trblxy]?|top|left|right" +
        "|bottom|inset(?:-[xy])?|leading|basis|space-[xy])-\\[-?\\d+(?:\\.\\d+)?px\\]",
    ),
    guidance:
      "spacing and sizes come from the 4px scale (w-80, h-8, gap-3), never one-off pixels; " +
      "a size the shared set lacks is added to src/shared/ui first",
  },
  "raw-color-class": {
    pattern: classToken(
      "(?:bg|text|border(?:-[trblxy])?|ring|divide|outline|fill|stroke|placeholder|caret" +
        "|decoration|from|to|via|shadow)-(?:charcoal|cream)(?:-[a-z0-9]+)*(?:\\/\\d+|\\/\\[[^\\]]+\\])?",
    ),
    guidance:
      "features don't pick colors: compose shared components, and for text use Text " +
      "tone=default|muted|bright|danger",
  },
} as const satisfies Record<string, UiRule>;

/** The subset that shared UI itself keeps to: its components are where these would start. */
export const sharedUiRuleIds = [
  "hex-color",
  "font-size-literal",
  "native-title",
  "ellipsis",
  "arbitrary-px",
] as const satisfies readonly (keyof typeof uiRules)[];

/** Rules for every .css file outside src/styles and src/shared/ui. */
export const cssRules = {
  "feature-stylesheet": {
    count: () => 1,
    guidance:
      "features have no stylesheets: compose shared components, and add a missing look to " +
      "src/shared/ui first",
  },
  "css-font-size": {
    pattern: /font-size:(?!\s*(?:var\(--text-|inherit\b|1em\b|100%))/g,
    guidance: "use var(--text-<role>): micro, caption, meta, control, body, page, title, display",
  },
  "css-hex": {
    count: (text) =>
      [...text.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)].filter(
        (match) => {
          // In a declaration, not an #id selector: the next delimiter is ; or }, not {.
          const rest = text.slice(match.index);
          const next = /[;{}]/.exec(rest)?.[0];
          return next !== "{";
        },
      ).length,
    guidance: "use theme color tokens instead of hex values",
  },
  "css-ellipsis": {
    pattern: /text-overflow:\s*ellipsis/g,
    guidance: "long text fades, never an ellipsis: use OverflowFadeText",
  },
  "css-mono": {
    pattern: /font-family:[^;}]*mono/g,
    allow: codeStylesheets,
    guidance: "monospace only inside code itself (the editor, diffs, the terminal, code blocks)",
  },
  "css-z": {
    pattern: /z-index:\s*-?\d/g,
    guidance: "use a layer token (var(--layer-…)) instead of a z-index number",
  },
} as const satisfies Record<string, UiRule>;

export type AppUiRuleId = keyof typeof uiRules;
export type CssRuleId = keyof typeof cssRules;
export type UiRuleId = AppUiRuleId | CssRuleId;

export const allRules: Record<UiRuleId, UiRule> = { ...uiRules, ...cssRules };

/** Every rule id, tsx and css, in a stable order. */
export const uiRuleIds = Object.keys(allRules) as UiRuleId[];

export function uiRuleGuidance(id: UiRuleId): string {
  return allRules[id].guidance;
}

export type UiViolationCounts = Partial<Record<UiRuleId, number>>;

export type UiViolationMap = Record<string, UiViolationCounts>;
