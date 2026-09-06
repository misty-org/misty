const active = new Map<symbol, { appId: string; viewId: string }>();
const unsaved = new Map<string, boolean>();

export function retainAppView(appId: string, viewId: string) {
  const key = Symbol();
  active.set(key, {appId, viewId});
  return () => {
    active.delete(key);
    if (![...active.values()].some(view => view.viewId === viewId)) unsaved.delete(viewId);
  };
}
export function setAppUnsaved(viewId: string, dirty: boolean) {
  if (dirty) unsaved.set(viewId, true); else unsaved.delete(viewId);
}
export function appViewHasUnsavedChanges(viewId: string) { return unsaved.has(viewId); }
export function assertAppsClosedForUpdate(appId?: string) {
  if ([...active.values()].some(view => !appId || view.appId === appId))
    throw new Error(appId
      ? "Save your work and close this app’s tabs before updating or removing it."
      : "Save your work and close your app tabs before installing the Misty update.");
}
