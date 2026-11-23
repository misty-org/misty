import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { editorChrome, mistyEditorTheme, mistyPageGutters } from "./misty_theme";

interface Palette {
  dark: boolean;
  background: string;
  foreground: string;
  gutter: string;
  gutterActive: string;
  selection: string;
  activeLine: string;
  cursor: string;
  keyword: string;
  string: string;
  function: string;
  type: string;
  number: string;
  comment: string;
  tag: string;
  property: string;
  meta: string;
  operator: string;
}

const palettes: Record<string, { label: string; palette: Palette }> = {
  "catppuccin-mocha": {
    label: "Catppuccin Mocha",
    palette: {
      dark: true,
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      gutter: "#6c7086",
      gutterActive: "#b4befe",
      selection: "#45475a",
      activeLine: "#2a2b3c",
      cursor: "#f5e0dc",
      keyword: "#cba6f7",
      string: "#a6e3a1",
      function: "#89b4fa",
      type: "#f9e2af",
      number: "#fab387",
      comment: "#9399b2",
      tag: "#f38ba8",
      property: "#b4befe",
      meta: "#f5c2e7",
      operator: "#89dceb",
    },
  },
  "catppuccin-latte": {
    label: "Catppuccin Latte",
    palette: {
      dark: false,
      background: "#eff1f5",
      foreground: "#4c4f69",
      gutter: "#8c8fa1",
      gutterActive: "#7287fd",
      selection: "#ccd0da",
      activeLine: "#e6e9ef",
      cursor: "#dc8a78",
      keyword: "#8839ef",
      string: "#40a02b",
      function: "#1e66f5",
      type: "#df8e1d",
      number: "#fe640b",
      comment: "#9ca0b0",
      tag: "#d20f39",
      property: "#7287fd",
      meta: "#ea76cb",
      operator: "#04a5e5",
    },
  },
  "tokyo-night": {
    label: "Tokyo Night",
    palette: {
      dark: true,
      background: "#1a1b26",
      foreground: "#c0caf5",
      gutter: "#3b4261",
      gutterActive: "#737aa2",
      selection: "#283457",
      activeLine: "#1e2030",
      cursor: "#c0caf5",
      keyword: "#bb9af7",
      string: "#9ece6a",
      function: "#7aa2f7",
      type: "#2ac3de",
      number: "#ff9e64",
      comment: "#565f89",
      tag: "#f7768e",
      property: "#73daca",
      meta: "#e0af68",
      operator: "#89ddff",
    },
  },
  "gruvbox-dark": {
    label: "Gruvbox Dark",
    palette: {
      dark: true,
      background: "#282828",
      foreground: "#ebdbb2",
      gutter: "#7c6f64",
      gutterActive: "#d5c4a1",
      selection: "#504945",
      activeLine: "#32302f",
      cursor: "#ebdbb2",
      keyword: "#fb4934",
      string: "#b8bb26",
      function: "#fabd2f",
      type: "#fabd2f",
      number: "#d3869b",
      comment: "#928374",
      tag: "#fb4934",
      property: "#83a598",
      meta: "#fe8019",
      operator: "#8ec07c",
    },
  },
  "gruvbox-light": {
    label: "Gruvbox Light",
    palette: {
      dark: false,
      background: "#fbf1c7",
      foreground: "#3c3836",
      gutter: "#a89984",
      gutterActive: "#3c3836",
      selection: "#ebdbb2",
      activeLine: "#f2e5bc",
      cursor: "#3c3836",
      keyword: "#9d0006",
      string: "#79740e",
      function: "#b57614",
      type: "#076678",
      number: "#8f3f71",
      comment: "#928374",
      tag: "#9d0006",
      property: "#076678",
      meta: "#af3a03",
      operator: "#427b58",
    },
  },
  "one-dark": {
    label: "One Dark",
    palette: {
      dark: true,
      background: "#282c34",
      foreground: "#abb2bf",
      gutter: "#4b5263",
      gutterActive: "#abb2bf",
      selection: "#3e4451",
      activeLine: "#2c313c",
      cursor: "#528bff",
      keyword: "#c678dd",
      string: "#98c379",
      function: "#61afef",
      type: "#e5c07b",
      number: "#d19a66",
      comment: "#5c6370",
      tag: "#e06c75",
      property: "#e06c75",
      meta: "#56b6c2",
      operator: "#56b6c2",
    },
  },
  "rose-pine": {
    label: "Rosé Pine",
    palette: {
      dark: true,
      background: "#191724",
      foreground: "#e0def4",
      gutter: "#6e6a86",
      gutterActive: "#e0def4",
      selection: "#403d52",
      activeLine: "#21202e",
      cursor: "#e0def4",
      keyword: "#31748f",
      string: "#f6c177",
      function: "#ebbcba",
      type: "#9ccfd8",
      number: "#ebbcba",
      comment: "#6e6a86",
      tag: "#eb6f92",
      property: "#c4a7e7",
      meta: "#c4a7e7",
      operator: "#908caa",
    },
  },
};

export const editorThemes: readonly { value: string; label: string }[] = [
  { value: "misty", label: "Misty" },
  ...Object.entries(palettes).map(([value, { label }]) => ({ value, label })),
];

function paletteTheme(p: Palette): Extension {
  return [
    editorChrome,
    Prec.high(
      EditorView.theme(
        {
          "&": { color: p.foreground, backgroundColor: p.background },
          ".cm-content": { caretColor: p.cursor },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: p.cursor },
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
            { backgroundColor: p.selection },
          ".cm-activeLine": { backgroundColor: p.activeLine },
          ".cm-gutters": { backgroundColor: p.background, color: p.gutter },
          ".cm-activeLineGutter": { backgroundColor: p.background, color: p.gutterActive },
          ".cm-selectionMatch, .cm-searchMatch": { backgroundColor: p.selection },
          ".cm-matchingBracket": { backgroundColor: p.selection },
        },
        { dark: p.dark },
      ),
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: p.keyword },
        { tag: [t.string, t.special(t.string), t.regexp, t.character], color: p.string },
        {
          tag: [
            t.function(t.variableName),
            t.function(t.propertyName),
            t.definition(t.function(t.variableName)),
          ],
          color: p.function,
        },
        { tag: [t.typeName, t.className, t.namespace], color: p.type },
        { tag: [t.number, t.bool, t.atom, t.null], color: p.number },
        { tag: [t.tagName, t.self], color: p.tag },
        { tag: [t.propertyName, t.attributeName, t.labelName], color: p.property },
        { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: p.comment },
        { tag: [t.meta, t.annotation, t.processingInstruction], color: p.meta },
        { tag: [t.operator, t.punctuation, t.separator], color: p.operator },
        { tag: t.heading, color: p.function, fontWeight: "600" },
        { tag: t.emphasis, fontStyle: "italic" },
        { tag: t.strong, fontWeight: "600" },
        { tag: t.link, color: p.function, textDecoration: "underline" },
        { tag: t.inserted, color: p.string },
        { tag: [t.deleted, t.invalid], color: p.tag },
      ]),
    ),
  ];
}

const built = new Map<string, Extension>();

export function editorThemeExtension(id: string): Extension {
  const known = built.get(id);
  if (known) return known;
  const entry = palettes[id];
  const extension = entry ? paletteTheme(entry.palette) : mistyEditorTheme;
  built.set(id, extension);
  return extension;
}

export const editorFonts: readonly { value: string; label: string; family: string }[] = [
  {
    value: "jetbrains-mono",
    label: "JetBrains Mono",
    family: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace',
  },
  { value: "system", label: "System", family: "var(--font-mono)" },
];

const fonts = new Map<string, Extension>();

export function editorFontExtension(id: string): Extension {
  const known = fonts.get(id);
  if (known) return known;
  const font = editorFonts.find((entry) => entry.value === id) ?? editorFonts[0];
  const extension = Prec.high(
    EditorView.theme({
      ".cm-scroller": { fontFamily: font.family, lineHeight: "1.6" },
    }),
  );
  fonts.set(id, extension);
  return extension;
}

export function editorPageThemeExtension(id: string): Extension {
  return palettes[id] ? editorThemeExtension(id) : [mistyEditorTheme, mistyPageGutters];
}
