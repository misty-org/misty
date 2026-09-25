import { codeReadTextFile } from "./native";
import { useCodingWorkspaceStore } from "./store/useCodingWorkspaceStore";

export function openFileInWorkspace(
  path: string,
  name: string,
  targetLine: number | undefined,
  viewId: string,
  rootPath: string,
): void {
  const store = useCodingWorkspaceStore.getState();
  const existing = store.projectBuffers[rootPath]?.[path];
  if (existing) {
    store.setActiveFile(rootPath, viewId, path);
    store.recordRecent(rootPath, path);
    if (targetLine !== undefined) {
      window.dispatchEvent(
        new CustomEvent("misty:code-goto-line", { detail: { path, line: targetLine } }),
      );
    }
    return;
  }
  store.openFile(rootPath, viewId, {
    path,
    name,
    contents: "",
    savedContents: "",
    lineEnding: "lf",
    readonly: false,
    loading: true,
    error: null,
  });
  store.recordRecent(rootPath, path);
  codeReadTextFile(path)
    .then((file) => {
      store.patchBuffer(rootPath, path, {
        contents: file.contents,
        savedContents: file.contents,
        lineEnding: file.lineEnding,
        readonly: file.readonly,
        loading: false,
        loaded: true,
        error: null,
      });
      if (targetLine !== undefined) {
        window.setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("misty:code-goto-line", { detail: { path, line: targetLine } }),
            ),
          0,
        );
      }
    })
    .catch((error: unknown) => {
      store.patchBuffer(rootPath, path, {
        loading: false,
        error: error instanceof Error ? error.message : "Could not open this file.",
      });
    });
}

export async function ensureProjectBuffer(rootPath: string, path: string, name: string) {
  const store = useCodingWorkspaceStore.getState();
  const existing = store.projectBuffers[rootPath]?.[path];
  if (existing && !existing.loading) return existing;
  if (!existing) {
    store.ensureBuffer(rootPath, {
      path,
      name,
      contents: "",
      savedContents: "",
      lineEnding: "lf",
      readonly: false,
      loading: true,
      error: null,
    });
  }
  try {
    const file = await codeReadTextFile(path);
    store.patchBuffer(rootPath, path, {
      contents: file.contents,
      savedContents: file.contents,
      lineEnding: file.lineEnding,
      readonly: file.readonly,
      loading: false,
      loaded: true,
      error: null,
    });
  } catch (error) {
    store.patchBuffer(rootPath, path, {
      loading: false,
      error: error instanceof Error ? error.message : "Could not open this file.",
    });
  }
  return useCodingWorkspaceStore.getState().projectBuffers[rootPath]?.[path] ?? null;
}
