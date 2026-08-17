import { codeReadTextFile } from "./native";
import { useCodingWorkspaceStore } from "./store/useCodingWorkspaceStore";

export function openFileInWorkspace(
  path: string,
  name: string,
  targetLine?: number,
  groupId?: string,
): void {
  const store = useCodingWorkspaceStore.getState();
  const targetGroupId = groupId ?? store.activeGroupId;
  const existing = store.groups
    .find((group) => group.id === targetGroupId)
    ?.tabs.find((tab) => tab.path === path);
  if (existing) {
    store.setActiveTab(targetGroupId, path);
    if (targetLine !== undefined) {
      window.dispatchEvent(
        new CustomEvent("misty:code-goto-line", { detail: { path, line: targetLine } }),
      );
    }
    return;
  }
  store.openTab(
    {
      path,
      name,
      contents: "",
      savedContents: "",
      lineEnding: "lf",
      readonly: false,
      loading: true,
      error: null,
    },
    targetGroupId,
  );
  codeReadTextFile(path)
    .then((file) => {
      store.patchTab(path, {
        contents: file.contents,
        savedContents: file.contents,
        lineEnding: file.lineEnding,
        readonly: file.readonly,
        loading: false,
        error: null,
      });
      if (targetLine !== undefined) {
        window.dispatchEvent(
          new CustomEvent("misty:code-goto-line", { detail: { path, line: targetLine } }),
        );
      }
    })
    .catch((error: unknown) => {
      store.patchTab(path, {
        loading: false,
        error: error instanceof Error ? error.message : "Could not open this file.",
      });
    });
}
