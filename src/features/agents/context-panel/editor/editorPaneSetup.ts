import { Prec } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

/*
 * The file editor's fixed CodeMirror setup: its frame, the platform it keys for, and the
 * extensions every file gets.
 */

/** CodeMirror fills the pane; inside the floating context card its own fills give way to the card's. */
export const editorFrameClass = [
  "context-editor relative flex min-h-0 min-w-0 flex-1 overflow-clip",
  "[&_.cm-editor]:h-full [&_.cm-theme-dark]:h-full",
  "in-[.agent-studio-context]:[&_.cm-editor]:bg-transparent!",
  "in-[.agent-studio-context]:[&_.cm-gutters]:bg-transparent!",
].join(" ");

export const IS_MAC = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
export const BASIC_SETUP = { foldGutter: false, highlightActiveLine: true };
/** A click in the line numbers selects the whole line. */
export const LINE_SELECTION = lineNumbers({
  domEventHandlers: {
    mousedown(view, block, event) {
      if ((event as MouseEvent).button !== 0) return false;
      const line = view.state.doc.lineAt(block.from);
      const end = line.to < view.state.doc.length ? line.to + 1 : line.to;
      view.focus();
      view.dispatch({ selection: { anchor: line.from, head: end }, userEvent: "select.pointer" });
      return true;
    },
  },
});
/** The code at the panel's caption size, its line numbers parted from it by a hairline. */
export const PANEL_THEME = Prec.highest(
  EditorView.theme({
    "&": { fontSize: "var(--text-caption)" },
    ".cm-gutters": { borderRight: "1px solid var(--color-charcoal-border)" },
  }),
);
