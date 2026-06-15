import { useEffect, type ComponentType } from "react";
import {
  createCodeMultibuffer,
  type CodeMultibufferServices,
} from "./components/createCodeMultibuffer";
import { createSdkWorkspaceEdits } from "./lsp/createSdkWorkspaceEdits";
import type { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createCodingWorkspace } from "./createCodingWorkspace";
import type { CodeWorkspaceServices } from "./codeWorkspaceServices";
import { createSdkCodeSearch } from "./sdkCodeSearch";
import { createSdkCodeCommandCenter } from "./components/createSdkCodeCommandCenter";
import { createSdkCodeExplorer } from "./components/createSdkCodeExplorer";
import { createCodeStatusBar } from "./components/createCodeStatusBar";
import { createOpenFolderCard } from "./components/createOpenFolderCard";
import { createCodeWorkspaceSupport } from "./createCodeWorkspaceSupport";
import type { CodeEditorServices } from "./components/createCodeEditor";

type Integrated =
  | "store"
  | "editorStore"
  | "openFileInWorkspace"
  | "useFileWatcher"
  | "CodeExplorer"
  | "CodeCommandCenter"
  | "CodeStatusBar"
  | "OpenFolderCard"
  | "basename"
  | "displayFileTitle"
  | "EmptyEditor"
  | "isOwnedTerminal"
  | "languageOf"
  | "useCodeCommands"
  | "CodeMultibuffer"
  | "prepareWorkspaceEdit";
export interface SdkCodeWorkspaceServices extends Omit<
  CodeWorkspaceServices,
  Integrated | "usePreferences"
> {
  usePreferences: CodeEditorServices["usePreferences"];
  findReferencesAt: CodeMultibufferServices["findReferencesAt"];
  documentVersion?(root: string, path: string): number | null;
  updatePreference(key: "font_size" | "interface_scale", value: number): void;
  ShortcutHint: ComponentType<{ commandId: string }>;
  FolderPicker: ComponentType<{ onCancel(): void; onSelect(path: string): void }>;
  ErrorActivity: CodeEditorServices["ErrorActivity"];
  openModelsSettings(): void;
  report(error: unknown): void;
}

/** Assemble the full workspace around one SDK mount. The host shell, language
 * services and AI UI still require explicit owning-app adapters. Views share
 * app data only when their runtime belongs to the same component session. */
export function createSdkCodingWorkspace(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  services: SdkCodeWorkspaceServices,
) {
  const search = createSdkCodeSearch(runtime);
  const edits = createSdkWorkspaceEdits(runtime, { documentVersion: services.documentVersion });
  const CodeMultibuffer = createCodeMultibuffer({
    store: runtime.store,
    editorStore: runtime.editor,
    usePreferences: services.usePreferences,
    useShortcutHandler: (id, run, enabled, priority) =>
      useEffect(
        () => services.registerShortcutHandler(id, run, enabled, priority),
        [id, run, enabled, priority],
      ),
    findInFiles: (root, query, sensitive, signal) => search.search(root, query, sensitive, signal),
    ensureBuffer: runtime.ensureFile,
    findReferencesAt: services.findReferencesAt,
    edits,
    saveFile: runtime.saveFile,
    report: services.report,
    ErrorActivity: services.ErrorActivity,
  });
  const support = createCodeWorkspaceSupport(services);
  const projectLabel = (root: string) =>
    runtime.hasProject(root) ? runtime.project(root).name : support.basename(root);
  const navigation = new Map<string, symbol>();
  const frames = new Set<number>();
  let closed = false;
  const Workspace = createCodingWorkspace({
    ...services,
    ...support,
    CodeMultibuffer,
    prepareWorkspaceEdit: edits.prepareWorkspaceEdit,
    basename: projectLabel,
    EmptyEditor: ({ rootPath, onOpen }) => (
      <support.EmptyEditor rootPath={projectLabel(rootPath)} onOpen={onOpen} />
    ),
    store: runtime.store,
    editorStore: runtime.editor,
    CodeCommandCenter: createSdkCodeCommandCenter(runtime, search, services),
    CodeExplorer: createSdkCodeExplorer(runtime, services),
    CodeStatusBar: createCodeStatusBar({
      ...services,
      store: runtime.store,
      editorStore: runtime.editor,
    }),
    OpenFolderCard: createOpenFolderCard(services.FolderPicker),
    // openProject already owns the recursive SDK watcher for the project's lifetime.
    useFileWatcher: () => undefined,
    openFileInWorkspace: (path, _name, line, viewId, root) => {
      if (closed) return;
      const token = Symbol();
      navigation.set(viewId, token);
      void runtime
        .openFile(root, path, viewId)
        .then(() => {
          if (closed || navigation.get(viewId) !== token || line === undefined) return;
          const frame = requestAnimationFrame(() => {
            frames.delete(frame);
            if (
              closed ||
              navigation.get(viewId) !== token ||
              runtime.store.getState().views[viewId]?.activeFilePath !== path
            )
              return;
            services.events.dispatchEvent(
              new CustomEvent("misty:code-goto-line", { detail: { path, line, viewId } }),
            );
          });
          frames.add(frame);
        })
        .catch((error) => {
          if (!closed && navigation.get(viewId) === token) services.report(error);
        });
    },
  });
  return {
    Workspace,
    search,
    edits,
    CodeMultibuffer,
    close() {
      if (closed) return;
      closed = true;
      search.close();
      edits.close();
      navigation.clear();
      frames.forEach(cancelAnimationFrame);
      frames.clear();
    },
  };
}
