import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const palette = {
  bg: "#131313",
  gutterBg: "#131313",
  gutterFg: "#5a5a5a",
  border: "#262626",
  fg: "#e0e0e0",
  fgBright: "#f1f1f1",
  fgMuted: "#8c8c8c",
  fgDim: "#5a5a5a",
  selection: "#2b2b2b",
  activeLine: "rgba(232, 217, 192, 0.05)",
  cursor: "#e8d9c0",
  matchingBracket: "#3e3e3e",
  keyword: "#c8c0b0",
  string: "#b8a887",
  fn: "#d8d0c0",
  comment: "#565247",
  punct: "#6f6a5f",
  number: "#c8b28a",
} as const;

const mistyTheme = EditorView.theme(
  {
    "&": {
      color: palette.fg,
      backgroundColor: palette.bg,
      height: "100%",
      fontSize: "12.5px",
    },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, "SF Mono", "JetBrains Mono", "Menlo", "Consolas", monospace',
      lineHeight: "1.65",
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: palette.cursor,
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: palette.cursor,
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: palette.selection,
    },
    ".cm-panels": {
      backgroundColor: "#161616",
      color: palette.fg,
      borderColor: palette.border,
    },
    ".cm-searchMatch": { backgroundColor: "rgba(232, 217, 192, 0.15)" },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(232, 217, 192, 0.35)",
    },
    ".cm-activeLine": { backgroundColor: palette.activeLine },
    ".cm-gutters": {
      backgroundColor: palette.gutterBg,
      color: palette.gutterFg,
      border: "none",
      borderRight: `1px solid ${palette.border}`,
    },
    ".cm-activeLineGutter": {
      color: palette.fgBright,
      backgroundColor: "transparent",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 12px 0 8px",
      fontVariantNumeric: "tabular-nums",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      color: palette.fgBright,
      outline: `1px solid ${palette.matchingBracket}`,
    },
    ".cm-tooltip": {
      backgroundColor: "#191919",
      color: palette.fg,
      border: `1px solid ${palette.border}`,
      borderRadius: "6px",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#191919",
      color: palette.fgMuted,
      border: `1px solid ${palette.border}`,
      borderRadius: "3px",
      padding: "0 4px",
    },
  },
  { dark: true },
);

const mistyHighlight = HighlightStyle.define([
  { tag: t.keyword, color: palette.keyword },
  { tag: [t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: palette.keyword },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: palette.fg },
  { tag: [t.propertyName], color: palette.fn },
  { tag: [t.function(t.variableName), t.labelName], color: palette.fn },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: palette.keyword },
  { tag: [t.definition(t.name), t.separator], color: palette.fg },
  { tag: [t.className, t.typeName], color: palette.fgBright },
  { tag: [t.number, t.changed, t.annotation, t.self, t.namespace], color: palette.number },
  { tag: [t.string, t.special(t.string)], color: palette.string },
  { tag: [t.operator, t.punctuation, t.bracket], color: palette.punct },
  { tag: [t.meta, t.comment], color: palette.comment, fontStyle: "italic" },
  { tag: t.link, color: palette.string, textDecoration: "underline" },
  { tag: t.heading, color: palette.fgBright, fontWeight: "600" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: palette.keyword },
  { tag: t.invalid, color: "#efab9f" },
]);

export const mistyCodeMirrorTheme: Extension = [
  mistyTheme,
  syntaxHighlighting(mistyHighlight),
];
