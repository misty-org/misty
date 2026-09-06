import { reportSystemError } from "@/features/activity/systemActivity";
import { useCodeOverlayAppearance } from "./useCodeOverlayAppearance";
import { lazy } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/features/workspace";
import { registerShortcutHandler, useShortcutTitle } from "@/features/shortcuts";
import { selectEditorPreferences, useSettingsStore } from "@/features/settings";
import { CodeCommandCenter } from "./components/CodeCommandCenter";
import {
  CodeEditor,
  codeActionsForEditor,
  documentSymbolsForEditor,
  editorLocation,
  editorWord,
  executeCodeActionCommand,
  renameForEditor,
  requestInlineAi,
  runEditorSelectionAction,
} from "./components/CodeEditor";
import { CodeExplorer } from "./components/CodeExplorer";
import { CodeMultibuffer } from "./components/CodeMultibuffer";
import { CodeStatusBar } from "./components/CodeStatusBar";
import { OpenFolderCard } from "./components/OpenFolderCard";
import { openFileInWorkspace } from "./openFile";
import { useCodingWorkspaceStore } from "./store/useCodingWorkspaceStore";
import { useEditorEphemeralStore } from "./store/useEditorEphemeralStore";
import { useFileWatcher } from "./watcher/useFileWatcher";
import { retainLspRoot } from "./lsp/useLsp";
import { prepareWorkspaceEdit } from "./lsp/workspaceEdits";
import { useCodeAiAdapter } from "./ai/useCodeAiAdapter";
import {
  basename,
  displayFileTitle,
  EmptyEditor,
  isOwnedTerminal,
  languageOf,
  useCodeCommands,
} from "./codeWorkspaceSupport";

import { createCodingWorkspace } from "./createCodingWorkspace";
const InlineRewrite = lazy(() =>
  import("./ai/InlineRewrite").then((module) => ({ default: module.InlineRewrite })),
);
export const CodingWorkspace = createCodingWorkspace({
  workspace: useWorkspaceStore,
  store: useCodingWorkspaceStore,
  editorStore: useEditorEphemeralStore,
  useShortcutTitle,
  registerShortcutHandler,
  usePreferences: () =>
    useSettingsStore(useShallow((state) => selectEditorPreferences(state.settings?.document))),
  useOverlayAppearance: useCodeOverlayAppearance,
  CodeCommandCenter,
  CodeEditor,
  CodeExplorer,
  CodeMultibuffer,
  CodeStatusBar,
  OpenFolderCard,
  InlineRewrite,
  codeActionsForEditor,
  documentSymbolsForEditor,
  editorLocation,
  editorWord,
  executeCodeActionCommand,
  renameForEditor,
  requestInlineAi,
  runEditorSelectionAction,
  openFileInWorkspace,
  useFileWatcher,
  retainLspRoot,
  prepareWorkspaceEdit,
  useCodeAiAdapter,
  basename,
  displayFileTitle,
  EmptyEditor,
  isOwnedTerminal,
  languageOf,
  useCodeCommands,
  events: window,
  report: (error) => {
    reportSystemError({ error, scope: "code:workspace", title: "Code workspace action failed" });
  },
});
