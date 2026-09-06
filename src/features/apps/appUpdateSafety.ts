const active = new Map<symbol, { appId: string; viewId: string }>();
const updating = new Set<string>();
const hostUpdate = "*";
const unsaved = new Map<string, boolean>();

export function retainAppView(appId: string, viewId: string) {
  if (updating.has(hostUpdate) || updating.has(appId))
    throw new Error("An update is being installed. Reopen this app when it finishes.");
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

export function reserveAppUpdate(appId?: string) {
  assertAppsClosedForUpdate(appId);
  if (updating.has(hostUpdate) || (appId ? updating.has(appId) : updating.size > 0))
    throw new Error("Wait for the current update to finish.");
  const key = appId ?? hostUpdate;
  updating.add(key);
  return () => { updating.delete(key); };
}
