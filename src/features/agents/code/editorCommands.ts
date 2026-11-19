import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * What an editor can be asked to do from inside it (vim's `:w`, `:q`, `:e`), supplied by the pane
 * that holds it. Read with `editorCommandsOf(view)`; an editor with none ignores the request.
 */
export interface EditorCommands {
  save(): void;
  /** Closes the file's tab, asking first when it has unsaved edits. */
  close(): void;
  /** Opens quick open on the editor's folder. */
  quickOpen(): void;
}

export const editorCommands = Facet.define<EditorCommands, EditorCommands | null>({
  combine: (values) => values[values.length - 1] ?? null,
});

export const editorCommandsOf = (view: EditorView): EditorCommands | null =>
  view.state.facet(editorCommands);
