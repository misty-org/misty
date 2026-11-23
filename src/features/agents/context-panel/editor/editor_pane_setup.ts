import { Prec } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

export const editorFrameClass = [
  "context-editor relative flex min-h-0 min-w-0 flex-1 overflow-clip",
  "[&_.cm-editor]:h-full [&_.cm-theme-dark]:h-full",
  "in-[.agent-studio-context]:[&_.cm-editor]:bg-transparent!",
  "in-[.agent-studio-context]:[&_.cm-gutters]:bg-transparent!",
].join(" ");

export const IS_MAC = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
export const BASIC_SETUP = { foldGutter: false, highlightActiveLine: true };
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
export const PANEL_THEME = Prec.highest(
  EditorView.theme({
    "&": { fontSize: "var(--text-caption)" },
    ".cm-gutters": { borderRight: "1px solid var(--color-charcoal-border)" },
  }),
);
