import { SystemErrorActivity } from "@/features/activity";
import { selectEditorPreferences, useSettingsStore } from "@/features/settings";
import { useShortcutHandler } from "@/features/shortcuts";
import { useShallow } from "zustand/react/shallow";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useEditorEphemeralStore } from "../store/useEditorEphemeralStore";
import { codeWriteTextFile } from "../native";
import * as lsp from "../lsp/codeMirrorLsp";
import { createCodeEditor } from "./createCodeEditor";

/** Existing host integration. Downloaded Code supplies its own services to the same editor. */
export const {
  CodeEditor,
  flushBuffer: flushEditorBuffer,
  requestInlineAi,
  runEditorSelectionAction,
  editorLocation,
  editorWord,
  documentSymbolsForEditor,
  codeActionsForEditor,
  renameForEditor,
  executeCodeActionCommand,
} = createCodeEditor({
  store: useCodingWorkspaceStore,
  editorStore: useEditorEphemeralStore,
  lsp,
  usePreferences: () =>
    useSettingsStore(useShallow((state) => selectEditorPreferences(state.settings?.document))),
  useShortcutHandler,
  writeFile: (_root, path, contents, lineEnding) => codeWriteTextFile(path, contents, lineEnding),
  events: window,
  ErrorActivity: SystemErrorActivity,
});
