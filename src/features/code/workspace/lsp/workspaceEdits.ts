import { ensureProjectBuffer } from "../openFile";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { flushEditorBuffer } from "../components/CodeEditor";
import { documentVersion } from "./codeMirrorLsp";
import { createWorkspaceEdits } from "./createWorkspaceEdits";
export * from "./textEdits";
export type { WorkspaceEditFilePreview, WorkspaceEditPreview } from "./createWorkspaceEdits";

/** Existing host integration; downloaded Code creates an instance with its own SDK buffers. */
export const {
  prepareWorkspaceEdit,
  getWorkspaceEditPreview,
  applyWorkspaceEditPreview,
  discardWorkspaceEditPreview,
} = createWorkspaceEdits({
  store: useCodingWorkspaceStore,
  flushBuffer: flushEditorBuffer,
  documentVersion,
  ensureBuffer: (root, path) => ensureProjectBuffer(root, path, path.split("/").pop() ?? path),
});
