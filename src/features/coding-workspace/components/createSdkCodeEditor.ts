import type { createSdkCodeRuntime } from "../sdkCodeRuntime";
import { createCodeEditor, type CodeEditorServices } from "./createCodeEditor";

/** Keep live editor contents, save ordering and disk observation in the same SDK runtime. */
export function createSdkCodeEditor(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  services: Omit<
    CodeEditorServices,
    "store" | "editorStore" | "writeFile" | "pendingContent" | "registerBufferFlusher"
  >,
) {
  return createCodeEditor({
    ...services,
    immediateContent: Boolean(runtime.sharedState),
    writeOwnsSavedState: true,
    store: runtime.store,
    editorStore: runtime.editor,
    writeFile: (root, path, contents) => runtime.saveFile(root, path, contents),
    pendingContent: runtime.pendingContent,
    registerBufferFlusher: runtime.registerBufferFlusher,
  });
}
