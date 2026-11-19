import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, scrollPastEnd } from "@codemirror/view";

/** A share of the code's own text color, so guides and outlines follow every theme. */
const ink = (percent: number) => `color-mix(in srgb, currentColor ${percent}%, transparent)`;

/**
 * The Code page editor's present-day look, under any theme, after Zed and recent VS Code: faint
 * indent guides with the cursor's block brighter, no band behind the current line (its number
 * brightens instead), a 2px caret that glides between places, rounded selections, outlined
 * matching brackets and search hits rather than filled ones, room around the code, and scrolling
 * past the last line.
 */
export const modernEditor: Extension = [
  scrollPastEnd(),
  indentationMarkers({
    highlightActiveBlock: true,
    hideFirstIndent: true,
    markerType: "codeOnly",
    thickness: 1,
    colors: { light: ink(10), dark: ink(10), activeLight: ink(28), activeDark: ink(28) },
  }),
  // Over every theme's own rules: these are the shape, the theme keeps the colors.
  Prec.highest(
    EditorView.theme({
      ".cm-scroller": {
        fontVariantLigatures: "contextual",
        WebkitFontSmoothing: "antialiased",
      },
      ".cm-content": { padding: "calc(var(--spacing) * 3) 0" },
      ".cm-line": { padding: "0 calc(var(--spacing) * 6) 0 calc(var(--spacing) * 1)" },
      // The numbers sit near the editor's left edge, as Neovim's do.
      ".cm-gutters": { paddingLeft: "var(--spacing)" },
      // Room for three digits, as Neovim keeps, so the code starts at the same place in every file
      // under a thousand lines. The width counts the padding too (the app's border-box sizing).
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "calc(3ch + var(--spacing) * 3)",
        padding: "0 calc(var(--spacing) * 3) 0 0",
      },
      // The Git change bars keep their column whether or not a line has one.
      ".cm-misty-changes": { minWidth: "calc(var(--spacing) * 1.5)" },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftWidth: "2px",
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
        borderRadius: "calc(var(--spacing) * 1)",
        padding: "0 calc(var(--spacing) * 1.5)",
      },
      ".cm-tooltip-autocomplete > ul > li": {
        padding: "calc(var(--spacing) * 0.5) calc(var(--spacing) * 2)",
        borderRadius: "calc(var(--spacing) * 1.5)",
      },
      ".cm-tooltip-autocomplete > ul": { padding: "calc(var(--spacing) * 1)" },
    }),
  ),
];
