import { createCodingWorkspaceStore } from "./store/createCodingWorkspaceStore";
import { createEditorEphemeralStore } from "./store/createEditorEphemeralStore";
import { createWorkspaceEditState } from "./lsp/createWorkspaceEdits";

/** Allocate once inside a component createSession, never as an ambient singleton.
 * It contains app data/coordination only; each runtime keeps its own SDK and grants. */
export function createSdkCodeSessionState() {
  const store = createCodingWorkspaceStore(),
    editor = createEditorEphemeralStore();
  const edits = createWorkspaceEditState();
  const lifetime = new AbortController();
  const reads = new Map<string, { signal: AbortSignal; promise: Promise<void> }>();
  const writes = new Map<string, Promise<void>>();
  const viewOwners = new Map<string, string>();
  const writeVersions = new Map<string, number>();
  const pendingContents = new Map<string, Set<string>>();
  const flushers = new Map<string, Map<string, () => void>>();
  return {
    store,
    editor,
    edits,
    reads,
    writes,
    viewOwners,
    writeVersions,
    pendingContents,
    flushers,
    signal: lifetime.signal,
    close() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      edits.close();
      reads.clear();
      writes.clear();
      viewOwners.clear();
      writeVersions.clear();
      pendingContents.clear();
      flushers.clear();
      store.setState(store.getInitialState(), true);
      editor.setState(editor.getInitialState(), true);
    },
  };
}
