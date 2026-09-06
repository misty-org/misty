import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { ShortcutHint } from "@/features/shortcuts";
import { createCodeWorkspaceSupport } from "./createCodeWorkspaceSupport";
export { basename, languageOf, isOwnedTerminal } from "./createCodeWorkspaceSupport";
export const { useCodeCommands, EmptyEditor, displayFileTitle } = createCodeWorkspaceSupport({
  workspace: useWorkspaceStore,
  ShortcutHint,
  openModelsSettings: () => {
    window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "models" } }));
  },
});
