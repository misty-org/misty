import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface EditorCommands {
  save(): void;
  close(): void;
  quickOpen(): void;
}

export const editorCommands = Facet.define<EditorCommands, EditorCommands | null>({
  combine: (values) => values[values.length - 1] ?? null,
});

export const editorCommandsOf = (view: EditorView): EditorCommands | null =>
  view.state.facet(editorCommands);
