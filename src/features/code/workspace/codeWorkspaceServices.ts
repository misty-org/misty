import type { useShortcutTitle as ServiceUseShortcutTitle } from "@/features/shortcuts";
import type { CodeCommandCenter as ServiceCodeCommandCenter } from "./components/CodeCommandCenter";
import type { CodeExplorer as ServiceCodeExplorer } from "./components/CodeExplorer";
import type { CodeMultibuffer as ServiceCodeMultibuffer } from "./components/CodeMultibuffer";
import type { CodeStatusBar as ServiceCodeStatusBar } from "./components/CodeStatusBar";
import type { OpenFolderCard as ServiceOpenFolderCard } from "./components/OpenFolderCard";
import type { InlineRewrite as ServiceInlineRewrite } from "./ai/InlineRewrite";
import type { openFileInWorkspace as ServiceOpenFileInWorkspace } from "./openFile";
import type { useFileWatcher as ServiceUseFileWatcher } from "./watcher/useFileWatcher";
import type { retainLspRoot as ServiceRetainLspRoot } from "./lsp/useLsp";
import type { prepareWorkspaceEdit as ServicePrepareWorkspaceEdit } from "./lsp/workspaceEdits";
import type { useCodeAiAdapter as ServiceUseCodeAiAdapter } from "./ai/useCodeAiAdapter";
import type { basename as ServiceBasename } from "./codeWorkspaceSupport";
import type { displayFileTitle as ServiceDisplayFileTitle } from "./codeWorkspaceSupport";
import type { EmptyEditor as ServiceEmptyEditor } from "./codeWorkspaceSupport";
import type { isOwnedTerminal as ServiceIsOwnedTerminal } from "./codeWorkspaceSupport";
import type { languageOf as ServiceLanguageOf } from "./codeWorkspaceSupport";
import type { useCodeCommands as ServiceUseCodeCommands } from "./codeWorkspaceSupport";
import type { ComponentType } from "react";
import type { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import type { createCodingWorkspaceStore } from "./store/createCodingWorkspaceStore";
import type { createEditorEphemeralStore } from "./store/createEditorEphemeralStore";
import type { createCodeEditor } from "./components/createCodeEditor";
import type { EditorPreferences } from "@/features/settings";

type HostWorkspace = ReturnType<typeof useWorkspaceStore.getState>;
export type CodeWorkspaceState = Pick<
  HostWorkspace,
  | "layout"
  | "activeScopeKey"
  | "updateTabState"
  | "renameTab"
  | "focusTab"
  | "closeTab"
  | "dockTab"
  | "toggleSidebar"
> & {
  openSurface(
    request: Parameters<HostWorkspace["openSurface"]>[0],
  ): ReturnType<HostWorkspace["openSurface"]> | Promise<ReturnType<HostWorkspace["openSurface"]>>;
};
export interface CodeWorkspaceStore {
  <T>(selector: (state: CodeWorkspaceState) => T): T;
  getState(): CodeWorkspaceState;
}
export interface CodeWorkspaceServices extends Pick<
  ReturnType<typeof createCodeEditor>,
  | "CodeEditor"
  | "codeActionsForEditor"
  | "documentSymbolsForEditor"
  | "editorLocation"
  | "editorWord"
  | "executeCodeActionCommand"
  | "renameForEditor"
  | "requestInlineAi"
  | "runEditorSelectionAction"
> {
  toggleTerminal?(placement: "down" | "up" | "left" | "right" | "current"): Promise<void>;
  workspace: CodeWorkspaceStore;
  store: ReturnType<typeof createCodingWorkspaceStore>;
  editorStore: ReturnType<typeof createEditorEphemeralStore>;
  events: EventTarget;
  report(error: unknown): void;
  usePreferences(): Pick<EditorPreferences, "theme" | "interfaceScale">;
  useOverlayAppearance(appearance: Pick<EditorPreferences, "theme" | "interfaceScale">): void;
  useShortcutTitle: typeof ServiceUseShortcutTitle;
  registerShortcutHandler(
    commandId: string,
    handler: () => boolean | void,
    enabled?: () => boolean,
    priority?: number,
  ): () => void;
  CodeCommandCenter: typeof ServiceCodeCommandCenter;
  CodeExplorer: typeof ServiceCodeExplorer;
  CodeMultibuffer: typeof ServiceCodeMultibuffer;
  CodeStatusBar: typeof ServiceCodeStatusBar;
  OpenFolderCard: typeof ServiceOpenFolderCard;
  InlineRewrite: ComponentType<React.ComponentProps<typeof ServiceInlineRewrite>>;
  openFileInWorkspace: typeof ServiceOpenFileInWorkspace;
  useFileWatcher: typeof ServiceUseFileWatcher;
  retainLspRoot: typeof ServiceRetainLspRoot;
  prepareWorkspaceEdit: typeof ServicePrepareWorkspaceEdit;
  useCodeAiAdapter: typeof ServiceUseCodeAiAdapter;
  basename: typeof ServiceBasename;
  displayFileTitle: typeof ServiceDisplayFileTitle;
  EmptyEditor: typeof ServiceEmptyEditor;
  isOwnedTerminal: typeof ServiceIsOwnedTerminal;
  languageOf: typeof ServiceLanguageOf;
  useCodeCommands: typeof ServiceUseCodeCommands;
}
