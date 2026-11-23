import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const editorChrome = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--color-cream)",
    backgroundColor: "transparent",
    fontSize: "var(--text-meta)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "var(--text-meta--line-height)",
  },
  ".cm-content": { caretColor: "var(--color-cream-bright)", padding: "var(--spacing) 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-cream-bright)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--color-row-active)" },
  ".cm-activeLine": { backgroundColor: "var(--color-row-hover)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "color-mix(in srgb, var(--color-cream-muted) 65%, transparent)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--color-cream)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 calc(var(--spacing) * 3) 0 calc(var(--spacing) * 2)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--color-control-hover)",
    border: "none",
    color: "var(--color-cream-muted)",
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "var(--color-control-active)",
    outline: "none",
  },
  ".cm-searchMatch": { backgroundColor: "var(--color-control-hover)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--color-control-active)" },
  ".cm-selectionMatch": { backgroundColor: "var(--color-control-hover)" },
  ".cm-tooltip": {
    backgroundColor: "var(--color-charcoal-card)",
    color: "var(--color-cream)",
    border: "1px solid var(--color-charcoal-border)",
    borderRadius: "calc(var(--spacing) * 3)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-row-active)",
    color: "var(--color-cream-bright)",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" },
  ".cm-completionDetail": { color: "var(--color-cream-muted)", fontStyle: "normal" },
  ".cm-panels": { backgroundColor: "var(--color-charcoal-card)", color: "var(--color-cream)" },
  ".cm-fat-cursor": { background: "var(--color-cream-muted)", outline: "none" },
  "&:not(.cm-focused) .cm-fat-cursor": {
    background: "transparent",
    outline: "1px solid var(--color-cream-muted)",
  },
  ".cm-vim-panel": { fontFamily: "var(--font-mono)", padding: "0 var(--spacing)" },

  ".cm-misty-changes .cm-gutterElement": { padding: "0", display: "flex", alignItems: "stretch" },
  ".cm-misty-changes": { cursor: "pointer" },
  ".cm-misty-change": {
    display: "block",
    width: "calc(var(--spacing) * 0.75)",
    borderRadius: "1px",
  },
  ".cm-misty-change-added": { backgroundColor: "var(--tone-added)" },
  ".cm-misty-change-changed": { backgroundColor: "var(--tone-waiting)" },
  ".cm-misty-change-removed": {
    alignSelf: "flex-start",
    height: "calc(var(--spacing) * 0.5)",
    width: "calc(var(--spacing) * 1.5)",
    backgroundColor: "var(--tone-failed)",
  },

  "&.cm-merge-b .cm-changedLine, & .cm-inlineChangedLine": {
    backgroundColor: "color-mix(in srgb, var(--tone-added) 10%, transparent)",
  },
  "&.cm-merge-b .cm-changedText": {
    background: "color-mix(in srgb, var(--tone-added) 28%, transparent)",
  },
  "& .cm-deletedChunk": {
    backgroundColor: "color-mix(in srgb, var(--tone-failed) 10%, transparent)",
  },
  "& .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: "color-mix(in srgb, var(--tone-failed) 28%, transparent)",
  },
  "& .cm-deletedChunk button": {
    color: "var(--color-cream)",
    backgroundColor: "var(--color-control-hover)",
    borderRadius: "calc(var(--spacing) * 1.5)",
    padding: "0 calc(var(--spacing) * 2)",
    font: "inherit",
    fontFamily: "var(--font-sans, inherit)",
    fontSize: "var(--text-caption)",
  },
  "& .cm-deletedChunk button:hover": { backgroundColor: "var(--color-control-active)" },
  "& .cm-deletedChunk button[name=accept], & .cm-deletedChunk button[name=reject]": {
    background: "var(--color-control-hover)",
  },
  "&.cm-merge-b .cm-changedLineGutter": { background: "var(--tone-added)" },
  "& .cm-deletedLineGutter": { background: "var(--tone-failed)" },
  "& .cm-inlineChangedLineGutter": { background: "var(--tone-waiting)" },
  "& .cm-collapsedLines": {
    color: "var(--color-cream-muted)",
    background: "var(--color-row-hover)",
  },
});

const highlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword],
    color: "var(--color-tone-violet)",
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--color-tone-green)" },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.definition(t.function(t.variableName)),
    ],
    color: "var(--color-tone-blue)",
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.number, t.bool, t.atom],
    color: "var(--color-tone-amber)",
  },
  { tag: [t.tagName, t.attributeName, t.self, t.null], color: "var(--color-tone-orange)" },
  { tag: [t.propertyName, t.labelName], color: "var(--color-cream)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "var(--color-cream-muted)",
  },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--color-tone-teal)" },
  { tag: [t.heading], color: "var(--color-cream-bright)", fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.link, color: "var(--color-tone-blue)", textDecoration: "underline" },
  { tag: [t.inserted], color: "var(--tone-added)" },
  { tag: [t.deleted, t.invalid], color: "var(--color-tone-red)" },
]);

export const mistyHighlighting: Extension = syntaxHighlighting(highlight);

export const mistyEditorTheme: Extension = [editorChrome, mistyHighlighting];

export const mistyPageGutters: Extension = Prec.high(
  EditorView.theme({
    ".cm-gutters, .cm-activeLineGutter": { backgroundColor: "var(--color-charcoal-bg)" },
  }),
);
