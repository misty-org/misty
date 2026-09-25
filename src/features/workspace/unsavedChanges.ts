const unsaved = new Set<string>();
let updating = false;
export function setWorkspaceUnsaved(viewId: string, dirty: boolean) {
  if (dirty) unsaved.add(viewId);
  else unsaved.delete(viewId);
}
export function workspaceViewHasUnsavedChanges(viewId: string) {
  return unsaved.has(viewId);
}
export function reserveMistyUpdate() {
  if (unsaved.size) throw new Error("Save your changes before installing the Misty update.");
  if (updating) throw new Error("Wait for the current update to finish.");
  updating = true;
  return () => {
    updating = false;
  };
}
