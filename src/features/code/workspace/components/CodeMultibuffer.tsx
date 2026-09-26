import { SystemErrorActivity } from "@/features/activity";
import { selectEditorPreferences, useSettingsStore } from "@/features/settings";
import { useShortcutHandler } from "@/features/shortcuts";
import { useShallow } from "zustand/react/shallow";
import { codeFindInFiles, codeWriteTextFile } from "../native";
import { ensureProjectBuffer } from "../openFile";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useEditorEphemeralStore } from "../store/useEditorEphemeralStore";
import { findReferencesAt } from "../lsp/codeMirrorLsp";
import * as edits from "../lsp/workspaceEdits";
import { createCodeMultibuffer } from "./createCodeMultibuffer";
export { buildMultibufferDocument, changesStayInsideExcerpts } from "./createCodeMultibuffer";
export const CodeMultibuffer = createCodeMultibuffer({
  store: useCodingWorkspaceStore,
  editorStore: useEditorEphemeralStore,
  usePreferences: () =>
    useSettingsStore(useShallow((state) => selectEditorPreferences(state.settings?.document))),
  useShortcutHandler,
  findInFiles: codeFindInFiles,
  ensureBuffer: ensureProjectBuffer,
  findReferencesAt,
  edits,
  async saveFile(root, path, contents, ending) {
    await codeWriteTextFile(path, contents, ending);
    useCodingWorkspaceStore
      .getState()
      .patchBuffer(root, path, { savedContents: contents, error: null });
  },
  report: (error) => console.error("Code results operation failed", error),
  ErrorActivity: SystemErrorActivity,
});
