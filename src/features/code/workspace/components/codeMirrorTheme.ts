import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

export interface ThemePalette {
  bg: string;
  gutterBg: string;
  gutterFg: string;
  border: string;
  panelBg: string;
  fg: string;
  fgBright: string;
  fgMuted: string;
  selection: string;
  activeLine: string;
  activeLineGutter: string;
  cursor: string;
  matchingBracket: string;
  matchingBracketOutline: string;
  searchMatch: string;
  searchMatchSelected: string;
  tooltipBg: string;

  red: string;
  green: string;
  yellow: string;
  blue: string;
  purple: string;
  aqua: string;
  orange: string;
  gray: string;
}

export const gruvboxDarkPalette: ThemePalette = {
  bg: "#282828",
  gutterBg: "#282828",
  gutterFg: "#7c6f64",
  border: "#3c3836",
  panelBg: "#202020",
  fg: "#ebdbb2",
  fgBright: "#fbf1c7",
  fgMuted: "#a89984",
  selection: "#504945",
  activeLine: "rgba(235, 219, 178, 0.06)",
  activeLineGutter: "#ebdbb2",
  cursor: "#ebdbb2",
  matchingBracket: "#504945",
  matchingBracketOutline: "#fabd2f",
  searchMatch: "rgba(250, 189, 47, 0.25)",
  searchMatchSelected: "rgba(254, 128, 25, 0.45)",
  tooltipBg: "#32302f",

  red: "#fb4934",
  green: "#b8bb26",
  yellow: "#fabd2f",
  blue: "#83a598",
  purple: "#d3869b",
  aqua: "#8ec07c",
  orange: "#fe8019",
  gray: "#928374",
};

export const gruvboxLightPalette: ThemePalette = {
  bg: "#fbf1c7",
  gutterBg: "#fbf1c7",
  gutterFg: "#928374",
  border: "#ebdbb2",
  panelBg: "#f2e5bc",
  fg: "#3c3836",
  fgBright: "#282828",
  fgMuted: "#7c6f64",
  selection: "#ebdbb2",
  activeLine: "rgba(60, 56, 54, 0.05)",
  activeLineGutter: "#282828",
  cursor: "#3c3836",
  matchingBracket: "#ebdbb2",
  matchingBracketOutline: "#b57614",
  searchMatch: "rgba(181, 118, 20, 0.25)",
  searchMatchSelected: "rgba(175, 58, 3, 0.40)",
  tooltipBg: "#f2e5bc",

  red: "#9d0006",
  green: "#79740e",
  yellow: "#b57614",
  blue: "#076678",
  purple: "#8f3f71",
  aqua: "#427b58",
  orange: "#af3a03",
  gray: "#928374",
};

export const mistyDarkPalette: ThemePalette = {
  bg: "#131313",
  gutterBg: "#131313",
  gutterFg: "#5a5a5a",
  border: "#262626",
  panelBg: "#161616",
  fg: "#e0e0e0",
  fgBright: "#f5f5f5",
  fgMuted: "#8c8c8c",
  selection: "#2b2b2b",
  activeLine: "rgba(232, 217, 192, 0.05)",
  activeLineGutter: "#f5f5f5",
  cursor: "#e8d9c0",
  matchingBracket: "#3e3e3e",
  matchingBracketOutline: "#e8d9c0",
  searchMatch: "rgba(232, 217, 192, 0.15)",
  searchMatchSelected: "rgba(232, 217, 192, 0.35)",
  tooltipBg: "#191919",

  red: "#d89c8a",
  green: "#b8bb87",
  yellow: "#e2c08d",
  blue: "#92b6b1",
  purple: "#d4a76a",
  aqua: "#88b49e",
  orange: "#d89c8a",
  gray: "#6b665c",
};

function createViewTheme(p: ThemePalette, isDark: boolean): Extension {
  return EditorView.theme(
    {
      "&": { color: p.fg, backgroundColor: p.bg, height: "100%" },
      ".cm-scroller": { lineHeight: "1.65", overflow: "auto" },
      ".cm-content": { caretColor: p.cursor },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: p.cursor, borderLeftWidth: "2px" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: p.selection,
      },
      ".cm-panels": { backgroundColor: p.panelBg, color: p.fg, borderColor: p.border },
      ".cm-searchMatch": { backgroundColor: p.searchMatch },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: p.searchMatchSelected },
      ".cm-activeLine": { backgroundColor: p.activeLine },
      ".cm-gutters": {
        backgroundColor: p.gutterBg,
        color: p.gutterFg,
        border: "none",
        borderRight: `1px solid ${p.border}`,
      },
      ".cm-activeLineGutter": {
        color: p.activeLineGutter,
        backgroundColor: "transparent",
        fontWeight: "500",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 12px 0 8px",
        fontVariantNumeric: "tabular-nums",
      },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: p.matchingBracket,
        outline: `1px solid ${p.matchingBracketOutline}`,
        borderRadius: "2px",
      },
      ".cm-tooltip": {
        backgroundColor: p.tooltipBg,
        color: p.fg,
        border: `1px solid ${p.border}`,
        borderRadius: "6px",
        boxShadow: isDark ? "0 6px 18px rgba(0, 0, 0, 0.4)" : "0 6px 18px rgba(0, 0, 0, 0.15)",
      },
      ".cm-tooltip-autocomplete ul": { maxHeight: "18em" },
      ".cm-tooltip-autocomplete li": {
        padding: "3px 8px",
        borderRadius: "4px",
        margin: "1px 2px",
      },
      ".cm-tooltip-autocomplete li[aria-selected]": {
        backgroundColor: p.selection,
        color: p.fgBright,
      },
      ".cm-completionLabel": { color: p.fg, fontWeight: "500" },
      ".cm-completionDetail": { color: p.fgMuted, fontStyle: "italic", marginLeft: "8px" },
      ".cm-completionMatchedText": {
        color: p.yellow,
        textDecoration: "none",
        fontWeight: "bold",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: isDark ? "#3c3836" : "#ebdbb2",
        color: p.fgMuted,
        border: `1px solid ${p.border}`,
        borderRadius: "3px",
        padding: "0 4px",
      },
    },
    { dark: isDark },
  );
}

function createHighlightStyle(p: ThemePalette): HighlightStyle {
  return HighlightStyle.define([
    { tag: [t.controlKeyword, t.moduleKeyword], color: p.red, fontWeight: "500" },
    { tag: [t.keyword, t.operatorKeyword], color: p.red },
    { tag: [t.modifier, t.special(t.keyword)], color: p.orange },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: p.blue },
    {
      tag: [t.definition(t.function(t.variableName)), t.labelName],
      color: p.blue,
      fontWeight: "600",
    },
    {
      tag: [t.className, t.typeName, t.namespace, t.standard(t.name)],
      color: p.yellow,
      fontWeight: "500",
    },
    {
      tag: [t.definition(t.className), t.definition(t.typeName)],
      color: p.yellow,
      fontWeight: "600",
    },
    { tag: [t.propertyName, t.attributeName], color: p.aqua },
    { tag: [t.string, t.special(t.string), t.character], color: p.green },
    { tag: t.regexp, color: p.aqua },
    { tag: t.escape, color: p.orange },
    { tag: [t.number, t.integer, t.float], color: p.purple },
    { tag: [t.bool, t.atom], color: p.purple, fontWeight: "500" },
    { tag: [t.self, t.special(t.variableName)], color: p.orange },
    { tag: [t.macroName, t.annotation], color: p.orange },
    { tag: [t.comment, t.meta, t.docComment], color: p.gray, fontStyle: "italic" },
    { tag: [t.variableName, t.name], color: p.fg },
    { tag: [t.definition(t.variableName), t.definition(t.name)], color: p.fgBright },
    { tag: [t.punctuation, t.bracket, t.separator], color: p.fgMuted },
    { tag: t.operator, color: p.aqua },
    { tag: t.heading, color: p.yellow, fontWeight: "bold" },
    { tag: t.link, color: p.blue, textDecoration: "underline" },
    { tag: t.url, color: p.aqua, textDecoration: "underline" },
    { tag: t.strong, fontWeight: "bold", color: p.fgBright },
    { tag: t.emphasis, fontStyle: "italic", color: p.fgBright },
    { tag: t.invalid, color: p.red, textDecoration: "underline wavy" },
    { tag: t.deleted, color: p.red },
    { tag: t.inserted, color: p.green },
    { tag: t.changed, color: p.yellow },
  ]);
}

export const gruvboxDarkTheme: Extension = [
  createViewTheme(gruvboxDarkPalette, true),
  syntaxHighlighting(createHighlightStyle(gruvboxDarkPalette)),
];

export const gruvboxLightTheme: Extension = [
  createViewTheme(gruvboxLightPalette, false),
  syntaxHighlighting(createHighlightStyle(gruvboxLightPalette)),
];

export const mistyCodeMirrorTheme: Extension = [
  createViewTheme(mistyDarkPalette, true),
  syntaxHighlighting(createHighlightStyle(mistyDarkPalette)),
];

export const editorThemeValues = ["gruvbox-dark", "gruvbox-light", "misty-dark"] as const;
export type EditorThemeId = (typeof editorThemeValues)[number];

export const editorThemeOptions = [
  { label: "Gruvbox Dark", value: "gruvbox-dark" },
  { label: "Gruvbox Light", value: "gruvbox-light" },
  { label: "Misty Charcoal", value: "misty-dark" },
];

export function resolveEditorTheme(themeId: string): Extension {
  switch (themeId) {
    case "gruvbox-light":
      return gruvboxLightTheme;
    case "misty-dark":
      return mistyCodeMirrorTheme;
    case "gruvbox-dark":
    default:
      return gruvboxDarkTheme;
  }
}

export function resolveEditorPalette(themeId: string): ThemePalette {
  switch (themeId) {
    case "gruvbox-light":
      return gruvboxLightPalette;
    case "misty-dark":
      return mistyDarkPalette;
    case "gruvbox-dark":
    default:
      return gruvboxDarkPalette;
  }
}

export function createEditorTypographyTheme(fontSize = 14, fontFamily = ""): Extension {
  return EditorView.theme({
    "&": {
      fontSize: `${fontSize}px`,
    },
    ".cm-scroller": {
      fontFamily: fontFamily.trim()
        ? `${fontFamily}, ui-monospace, "SF Mono", "JetBrains Mono", "Menlo", "Consolas", monospace`
        : 'ui-monospace, "SF Mono", "JetBrains Mono", "Menlo", "Consolas", monospace',
    },
  });
}
