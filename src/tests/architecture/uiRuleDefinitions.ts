import {
  countButtonSizing,
  countIconSizing,
  countLeadingRowIcons,
  countSmallIconButtons,
  countLegacySizes,
  countLegacyVariants,
  countRawMenuRows,
  countRepeatedMenuIcons,
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
 * those, with any variant prefixes (`hover:`, `md:`, `[&_svg]:`, `data-[state=open]:`,
 * `group-hover/row:`) and the `!` modifier. Prose and
 * function names (`truncate(text)`) don't match.
 */
function classToken(body: string): RegExp {
  return new RegExp(
    `(?<=["'\`\\s{])(?:[a-z0-9-]+(?:-\\[[^\\]\\s"'\`]+\\])?(?:\\/[\\w-]+)?:|\\[[^\\]\\s"'\`]+\\]:)*!?(?:${body})(?=["'\`\\s}])`,
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

/**
 * Sign-in and sign-up: the first screen a person sees sets its fields at 44px, beside 44px
 * buttons, larger than the app's own controls.
 */
const signInScreens = [
  /^src\/features\/account\/components\/(?:AuthField|GoogleSignInButton)\.tsx$/,
] as const;

/** Stylesheets for code itself. */
const codeStylesheets = [
  /^src\/features\/agents\/context-panel\/codeViews\.css$/,
  /^src\/features\/agents\/context-panel\/terminal\/terminal\.css$/,
  /^src\/features\/agents\/runs\/markdown\//,
  /^src\/features\/spaces\/journal\/notes\/components\/noteTiptapEditor\.css$/,
] as const;

/**
 * Presented media: a Tutor slide and a video overview's scene, scaled with their stage or the
 * screen when presented. Their type and colors are the slide's or the frame's own, not the UI's.
 */
const presentedMedia = [
  /^src\/features\/agents\/tutor\/notebook\/tutorPresentation\.css$/,
] as const;

/**
 * Stylesheets that draw content rather than interface: code itself and presented media. They may
 * exist as feature stylesheets, since what they style is the content's own look, not Misty's.
 */
const contentStylesheets = [
  ...codeStylesheets,
  ...presentedMedia,
  // Skins for a third-party widget's own DOM (the photo editor, Excalidraw), which shared
  // components can't reach.
  /^src\/features\/files\/photo-editor\/photoEditor\.css$/,
  /^src\/features\/spaces\/journal\/drawings\/components\/collaborativeDrawingCanvas\.css$/,
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
    // IconButton is the one shared control built on Button's look.
    allow: [/^src\/shared\/ui\/controls\/IconButton\.tsx$/],
    guidance: "pick a Button or IconButton variant and size; use Pressable for surfaces",
  },
  "field-restyle": {
    // Fields, selects, search boxes, chips and segmented tracks wear the shared control frame
    // (controlFrame.ts), so a row of them lines up. A bare Input sits in a frame of its own.
    pattern: new RegExp(
      "<(?:Input|SearchField|SelectTrigger|OptionSelect|FilterChip|ChoiceGroup|SecretField" +
        '|ShortcutField)\\b(?![^<>]*variant="bare")(?:[^<>]|=>)*?(?:className|containerClassName)=' +
        '(?:"|\\{[^}]*")[^"]*(?<![\\w[-])(?:[a-z-]+:)*(?:h-\\d|rounded)',
      "g",
    ),
    allow: signInScreens,
    guidance:
      "a field, select, search box or chip keeps the shared control frame: set its width or " +
      "layout only, never its height or corners (Input variant compact is the 24px field)",
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
  "raw-menu-row": {
    count: countRawMenuRows,
    jsx: true,
    guidance:
      "every menu row is a MenuItem, MenuCheckItem, MenuRadioItem or MenuSubmenu; never a raw " +
      "DropdownMenu or ContextMenu item",
  },
  "repeated-menu-icon": {
    count: countRepeatedMenuIcons,
    jsx: true,
    guidance:
      "a list of like things (models, efforts, folders, agents, chats) is text alone: drop the " +
      "icon every row repeats, and give rows an icon only when it tells them apart",
  },
  "leading-icon-in-list-row": {
    count: countLeadingRowIcons,
    jsx: true,
    guidance:
      "list rows start with their text: use ListRow with label, state and menu, and no " +
      "leading icon",
  },
  "sparkles-icon": {
    pattern: /\b\w*Sparkles?\w*\b/g,
    guidance:
      "never the sparkles star (it reads as AI filler): pick an icon for what the thing is, " +
      "such as Cpu for a model, Globe for web research or ScrollText for a skill",
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
  "icon-sizing": {
    count: countIconSizing,
    jsx: true,
    guidance:
      "icons take no size or stroke of their own: the control they sit in draws every glyph at " +
      "one size and stroke, so leave off size, strokeWidth and size classes",
  },
  "button-sizing": {
    count: countButtonSizing,
    jsx: true,
    guidance:
      "a shared button's height, width and padding come from its size prop and the bar it sits " +
      "in: drop the size, height, width and padding classes",
  },
  "small-icon-button": {
    count: countSmallIconButtons,
    jsx: true,
    guidance:
      "IconButton size sm is only for an inline closer (Close, Remove, Clear, Dismiss) in a row " +
      "or tab; controls in a toolbar, rail or composer are md, so a row shares one height. A " +
      "row's own buttons go in RowTools, which makes them sm itself",
  },
  "row-hover-reveal": {
    // A row's buttons shown on its hover by hand: each one sized and spaced its own way.
    pattern: /\bgroup-(?:hover|focus-within|has-\[[^\]\s]*\])\/row:/g,
    guidance:
      'put a row\'s buttons in RowTools (reveal="hover", or "cover" to keep the name\'s ' +
      "width) and its ⋯ in RowActions: they show with the row and take its 24px size",
  },
  "raw-color-class": {
    // A theme color by name, or the same color smuggled in as a variable or an arbitrary property
    // (`bg-[var(--color-charcoal-card)]`, `[color:var(--tone-done)]`).
    pattern: classToken(
      "(?:bg|text|border(?:-[trblxy])?|ring|divide|outline|fill|stroke|placeholder|caret" +
        "|decoration|from|to|via|shadow)-(?:(?:charcoal|cream)(?:-[a-z0-9]+)*(?:\\/\\d+|\\/\\[[^\\]]+\\])?" +
        "|\\[[^\\]\\s]*var\\(--(?:color|misty-theme|tone|workspace-tab)-[^\\]\\s]*\\])" +
        "|\\[(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color" +
        "|caret-color|text-decoration-color|box-shadow):[^\\]\\s]*\\]",
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
  "sparkles-icon",
  // Shared components compose buttons too (InfoCorner's "i" was drawn round here).
  "button-restyle",
] as const satisfies readonly (keyof typeof uiRules)[];

/** Rules for every .css file outside src/styles and src/shared/ui. */
export const cssRules = {
  "feature-stylesheet": {
    count: () => 1,
    allow: contentStylesheets,
    guidance:
      "features have no stylesheets: compose shared components, and add a missing look to " +
      "src/shared/ui first",
  },
  "css-font-size": {
    pattern: /font-size:(?!\s*(?:var\(--text-|inherit\b|1em\b|100%))/g,
    allow: presentedMedia,
    guidance: "use var(--text-<role>): micro, caption, meta, control, body, page, title, display",
  },
  "css-hex": {
    allow: presentedMedia,
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
  "feature-css-rule": {
    // Counted per rule, not per file, so a stylesheet already in the baseline can't take more.
    allow: contentStylesheets,
    count: (text) =>
      [...text.matchAll(/([^{}@]+)\{[^{}]*\}/g)].filter(([, selector = ""]) => selector.trim())
        .length,
    guidance:
      "features add no CSS rules: compose shared components, and add a missing look to " +
      "src/shared/ui first",
  },
  "css-shared-slot": {
    // A shared component's parts are named by data-slot; a feature selector naming one restyles
    // the component from outside, as the Agents page once did to the composer twice over.
    count: (text) =>
      [...text.matchAll(/([^{}]+)\{[^{}]*\}/g)].filter(([, selector = ""]) =>
        /\[data-slot/.test(selector),
      ).length,
    guidance:
      "never style a shared component's parts from a feature: give the component the variant or " +
      "prop it lacks in src/shared/ui",
  },
  "css-icon-size": {
    // Sizing glyphs from a stylesheet is how one sidebar icon became 18px beside 16px ones.
    count: (text) =>
      [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
        ([, selector = "", body = ""]) =>
          /(?:^|[\s>+~,])svg\b|\.lucide\b/.test(selector) &&
          /(?:^|[;\s])(?:width|height|stroke-width)\s*:/.test(body),
      ).length,
    guidance:
      "every glyph is drawn at one size by the control it sits in: don't size svg or .lucide " +
      "in a stylesheet",
  },
  "css-button-state": {
    // A rule whose selector is a button in one of its states and that paints it: it replaces the
    // shared Button's hover, pressed and open looks, as the chat rail once did with all three.
    count: (text) =>
      [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector = "", body = ""]) => {
        const button = /button|btn|\[role=["']?(?:tab|button)/i.test(selector);
        const state =
          /:hover|:focus-visible|:active|\[aria-(?:pressed|expanded|selected)|\[data-state/.test(
            selector,
          );
        const paints =
          /(?:^|[;\s])(?:background(?:-color)?|color|border(?:-color)?|box-shadow|opacity)\s*:/.test(
            body,
          );
        return button && state && paints;
      }).length,
    guidance:
      "a button's hover, pressed and open looks belong to the shared Button: use its variants, " +
      "or add the look to src/shared/ui",
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
