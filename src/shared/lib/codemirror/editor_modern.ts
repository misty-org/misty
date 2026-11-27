import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, scrollPastEnd } from "@codemirror/view";

const ink = (percent: number) => `color-mix(in srgb, currentColor ${percent}%, transparent)`;

export const modernEditor: Extension = [
  scrollPastEnd(),
  indentationMarkers({
    highlightActiveBlock: true,
    hideFirstIndent: true,
    markerType: "codeOnly",
    thickness: 1,
    colors: { light: ink(10), dark: ink(10), activeLight: ink(28), activeDark: ink(28) },
  }),
  Prec.highest(
    EditorView.theme({
      ".cm-scroller": {
        fontVariantLigatures: "contextual",
        WebkitFontSmoothing: "antialiased",
      },
      ".cm-content": { padding: "calc(var(--spacing) * 3) 0" },
      ".cm-line": { padding: "0 calc(var(--spacing) * 6) 0 var(--spacing)" },
      ".cm-gutters": { paddingLeft: "var(--spacing)" },
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "calc(3ch + var(--spacing) * 3)",
        padding: "0 calc(var(--spacing) * 3) 0 0",
      },
      ".cm-misty-changes": { minWidth: "calc(var(--spacing) * 1.5)" },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftWidth: "1px",
        transition: "left 70ms ease-out, top 70ms ease-out",
      },
      ".cm-selectionBackground": { borderRadius: "calc(var(--spacing) * 0.75)" },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "transparent",
        outline: `1px solid ${ink(40)}`,
        borderRadius: "2px",
      },
      ".cm-searchMatch": {
        backgroundColor: "transparent",
        outline: `1px solid ${ink(35)}`,
        borderRadius: "2px",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: ink(14),
        outline: `1px solid ${ink(60)}`,
      },
      ".cm-selectionMatch": { backgroundColor: ink(10), borderRadius: "2px" },
      ".cm-foldPlaceholder": {
        borderRadius: "var(--spacing)",
        padding: "0 calc(var(--spacing) * 1.5)",
      },
      ".cm-tooltip-autocomplete > ul > li": {
        padding: "calc(var(--spacing) * 0.5) calc(var(--spacing) * 2)",
        borderRadius: "calc(var(--spacing) * 1.5)",
      },
      ".cm-tooltip-autocomplete > ul": { padding: "var(--spacing)" },
    }),
  ),
];
