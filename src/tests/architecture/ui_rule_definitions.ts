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
} from "./ui_rule_counters.ts";
import { classToken } from "./ui_class_token.ts";
import { codeViews } from "./ui_code_views.ts";

export interface UiRule {
  guidance: string;
  pattern?: RegExp;
  count?: Counter;
  allow?: readonly RegExp[];
  jsx?: boolean;
}

const signInScreens = [
  /^src\/features\/account\/components\/(?:AuthField|GoogleSignInButton)\.tsx$/,
] as const;

const codeStylesheets = [
  /^src\/features\/agents\/context-panel\/code_views\.css$/,
  /^src\/features\/agents\/context-panel\/terminal\/terminal\.css$/,
  /^src\/features\/agents\/runs\/markdown\//,
  /^src\/features\/spaces\/journal\/notes\/components\/note_tiptap_editor\.css$/,
] as const;

const presentedMedia = [
  /^src\/features\/agents\/tutor\/notebook\/tutorPresentation\.css$/,
] as const;

const contentStylesheets = [...codeStylesheets, ...presentedMedia] as const;

const searchSiteRecognizers = [/^src\/features\/agents\/programs\/search_redirect\.ts$/] as const;

const themeData = [/^src\/features\/settings\/preferences\/app_theme\.ts$/] as const;

export const uiRules = {
  "raw-control": {
    pattern: /<(?:button|input|select|textarea)\b/g,
    guidance: "use Button, IconButton, Input, Select, or Textarea from @misty/ui",
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
    pattern: new RegExp(
      '<(?:Button|IconButton)\\b(?:[^>]|=>)*?className=(?:"|\\{[^}]*")' +
        '[^"]*(?<![\\w[-])(?:[a-z-]+:)*(?:bg-|rounded|shadow-|ring-|border-(?!0\\b))',
      "g",
    ),
    allow: [/^src\/shared\/ui\/controls\/IconButton\.tsx$/],
    guidance: "pick a Button or IconButton variant and size; use Pressable for surfaces",
  },
  "field-restyle": {
    pattern: new RegExp(
      "<(?:Input|SearchField|SelectTrigger|OptionSelect|ChoiceGroup|SecretField" +
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
    guidance: "use Spinner where the work happens; a button just goes disabled",
  },
  "all-caps": {
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
      "SkeletonList), or PaneLoading when its shape depends on the data, and work on a click disables its Button while progress shows where the work happens",
  },
  "status-word": {
    count: countStatusWords,
    guidance:
      "no loose status words: changes save themselves, and a failure shows next to what " +
      "failed (FieldError, or notify with tone danger)",
  },
  "middle-dot": {
    pattern: /·/g,
    guidance:
      'no middle dot between facts ("Sam made Harbor · just now"): give the time or state its own ' +
      'place at the row\'s end, say it in plain words ("3 replies from Ana"), split it into a label ' +
      "and a description, or use a comma; never another separator glyph",
  },
  "legacy-button-variant": {
    count: countLegacyVariants,
    guidance:
      "Button and IconButton variants are primary, secondary, quiet and danger (IconButton also " +
      "overlay; store actions get and get-filled): default and outline → secondary, ghost, toolbar and link → quiet, destructive " +
      "→ danger, chip → ChoiceGroup. An old variant's size sm is 32: make it md",
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
  "chip-row": {
    pattern: /\b(?:FilterChip|CollectionFilters|SectionChip)\b/g,
    guidance:
      "never a row of category chips or section buttons: stack a list's groups as Shelfs or under " +
      "SectionHeadings, give a page's sections headed groups down the page, filter " +
      "with CollectionFilterMenu, and put a bar's controls in CollectionControls",
  },
  "sparkles-icon": {
    pattern: /\b\w*Sparkles?\w*\b/g,
    guidance:
      "never the sparkles star (it reads as AI filler): pick an icon for what the thing is, " +
      "such as Cpu for a model, Globe for web research or ScrollText for a skill",
  },
  "skeleton-fallback": {
    pattern: /fallback=\{\s*<(?:\w*Skeleton|PaneLoading)\b/g,
    jsx: true,
    guidance:
      "load a tool's code with lazyTool inside ToolSuspense, which says \"Setting up the code " +
      'editor" and offers Try again; never a skeleton or PaneLoading fallback, which stand in for data ' +
      "only",
  },
  duckduckgo: {
    pattern: /duckduckgo/gi,
    allow: searchSiteRecognizers,
    guidance: "the agent browser opens on a blank page and searches with Google, never DuckDuckGo",
  },
  "half-pixel-edge": {
    pattern: /(?<![\d.])0?\.5px/g,
    guidance:
      "an edge is never 0.5px: use var(--hairline) or the hairline-outline utility (1px below " +
      "2x screens, 0.5px on them); a half pixel fades out on Windows' scaled displays and " +
      "rounded corners look cut off",
  },
  "focus-ring": {
    pattern:
      /(?<![\w-])(?:group-|peer-)?focus(?:-visible|-within)?(?:\/[\w-]+)?:(?:[\w-]+:)*-?(?:outline|ring|shadow)(?!-none\b|-hidden\b)/g,
    guidance:
      "focus never draws a ring, outline or glow: a focused control shows its hover wash " +
      "(Pressable, Button and IconButton already do), a field its edge",
  },
  "arbitrary-px": {
    pattern: classToken(
      "-?(?:h|w|min-h|min-w|max-h|max-w|size|gap(?:-[xy])?|p[trblxy]?|m[trblxy]?|top|left|right" +
        "|bottom|inset(?:-[xy])?|leading|basis|space-[xy])-\\[-?\\d+(?:\\.\\d+)?px\\]",
    ),
    guidance:
      "spacing and sizes come from the 4px scale (w-80, h-8, gap-3), never one-off pixels; " +
      "a size the shared set lacks is added to @misty/ui first",
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
    pattern: /\bgroup-(?:hover|focus-within|has-\[[^\]\s]*\])\/row:/g,
    guidance:
      'put a row\'s buttons in RowTools (reveal="hover", or "cover" to keep the name\'s ' +
      "width) and its ⋯ in RowActions: they show with the row and take its 24px size",
  },
  "raw-color-class": {
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
  "raw-type-size": {
    pattern: classToken("text-(?:3xs|2xs|xs|sm|md|base|lg|xl|2xl|3xl)"),
    guidance:
      "use a type role, never Tailwind's sizes: Text size=micro|caption|meta|control|body|page|" +
      "title|display (meta for a muted line, control for a row's label)",
  },
  "row-divider": {
    pattern: classToken("divide-[xy](?:-\\d+)?"),
    guidance:
      "rows that belong together sit on one fill with no lines between them: put them in a " +
      "RowGroupSection (or SettingsSection), and keep hairlines for the page's frame",
  },
} as const satisfies Record<string, UiRule>;

export const cssRules = {
  "feature-stylesheet": {
    count: () => 1,
    allow: contentStylesheets,
    guidance:
      "features have no stylesheets: compose shared components, and add a missing look to " +
      "@misty/ui first",
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
  "css-half-pixel-edge": {
    pattern: /(?<![\d.])0?\.5px/g,
    guidance:
      "an edge is never 0.5px: use var(--hairline) or the hairline-outline utility (1px below " +
      "2x screens, 0.5px on them); a half pixel fades out on Windows' scaled displays and " +
      "rounded corners look cut off",
  },
  "css-focus-ring": {
    pattern:
      /:focus(?:-visible|-within)?[^{}]*\{[^}]*(?:outline(?:-width|-style|-color)?|box-shadow)\s*:\s*(?!none\b|0\b|transparent\b)/g,
    guidance:
      "focus never draws a ring, outline or glow: a focused control shows its hover wash, a " +
      "field its edge",
  },
  "css-z": {
    pattern: /z-index:\s*-?\d/g,
    guidance: "use a layer token (var(--layer-…)) instead of a z-index number",
  },
  "feature-css-rule": {
    allow: contentStylesheets,
    count: (text) =>
      [...text.matchAll(/([^{}@]+)\{[^{}]*\}/g)].filter(([, selector = ""]) => selector.trim())
        .length,
    guidance:
      "features add no CSS rules: compose shared components, and add a missing look to " +
      "@misty/ui first",
  },
  "css-shared-slot": {
    count: (text) =>
      [...text.matchAll(/([^{}]+)\{[^{}]*\}/g)].filter(([, selector = ""]) =>
        /\[data-slot/.test(selector),
      ).length,
    guidance:
      "never style a shared component's parts from a feature: give the component the variant or " +
      "prop it lacks in @misty/ui",
  },
  "css-icon-size": {
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
      "or add the look to @misty/ui",
  },
} as const satisfies Record<string, UiRule>;

export type AppUiRuleId = keyof typeof uiRules;
export type CssRuleId = keyof typeof cssRules;

export type UiRuleId = AppUiRuleId | CssRuleId;

export const allRules: Record<UiRuleId, UiRule> = { ...uiRules, ...cssRules };

export const uiRuleIds = Object.keys(allRules) as UiRuleId[];

export function uiRuleGuidance(id: UiRuleId): string {
  return allRules[id].guidance;
}

export type UiViolationCounts = Partial<Record<UiRuleId, number>>;

export type UiViolationMap = Record<string, UiViolationCounts>;
