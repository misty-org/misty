import { ShortcutHint } from "@/features/shortcuts";
import { codeFindInFiles } from "../native";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { loadProjectFileIndex, invalidateProjectFileIndex } from "./codeCommandCenterModel";
import { createCodeCommandCenter } from "./createCodeCommandCenter";
export {
  rankFiles,
  commandCenterModeForInput,
  lineNumberForInput,
} from "./createCodeCommandCenter";
export type { CodeCommand, CodeTopAction, CommandCenterMode } from "./createCodeCommandCenter";
export const CodeCommandCenter = createCodeCommandCenter({
  events: window,
  store: useCodingWorkspaceStore,
  ShortcutHint,
  loadIndex: async (root) => ({ files: await loadProjectFileIndex(root) }),
  search: codeFindInFiles,
  subscribeIndex(root, listener) {
    const invalidate = (event: Event) => {
      if ((event as CustomEvent<{ rootPath?: string }>).detail?.rootPath !== root) return;
      invalidateProjectFileIndex(root);
      listener();
    };
    window.addEventListener("misty:code-index-invalidated", invalidate);
    return () => window.removeEventListener("misty:code-index-invalidated", invalidate);
  },
});
