import { installedDevelopmentRelease } from "@/api/apps/developmentRelease";
import { resolveApiBase } from "@/api/deployment/api";
import { invoke } from "@tauri-apps/api/core";
import { appsApi } from "@/api/apps";
import { assertStableApiSession, readApiSessionGeneration } from "@/api/client";
import { readActiveSavedAccountSession, accountScopeResetEvent } from "@/features/auth/runtimeSession";
import { installOfficialDesktopPackage, officialDesktopPackageReady } from "./desktopPackages";
import { useAppsStore } from "./useAppsStore";

// Concurrent previews/search/device helpers share the same live authority read.
// Keep no successful cache: the next operation still checks current Space access.
const authorityReads = new Map<string, ReturnType<typeof appsApi.installations>>();
function readInstallations(spaceId: string) {
  const generation = readApiSessionGeneration();
  const key = JSON.stringify([generation, spaceId]);
  const active = authorityReads.get(key);
  if (active) return active;
  const request = Promise.resolve().then(() => { assertStableApiSession(generation); return appsApi.installations(spaceId); }).finally(() => {
    if (authorityReads.get(key) === request) authorityReads.delete(key);
  });
  authorityReads.set(key, request);
  return request;
}

/** Host-only adapter for previously approved device scopes and Library selections.
 * A downloaded app cannot use this to submit arbitrary filesystem paths.
 */
export async function withNativeDocumentService<T>(
  appId: "files" | "library",
  spaceId: string,
  run: (instance: string) => Promise<T>,
  signal?: AbortSignal,
  purpose: "documents" | "search" | "previews" | "devices" = "documents",
): Promise<T> {
  const account = readActiveSavedAccountSession();
  const generation = readApiSessionGeneration();
  if (!account || !spaceId) throw new Error(`Open this app in a Space before using ${purpose}.`);
  const capability = "files.read";
  const capabilities = purpose === "devices" ? [capability, "connections.read"] : [capability];
  let instance = "";
  let invalid: Error | undefined;
  let rejectCancelled: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  // The session may invalidate during package verification, before the race starts.
  void cancelled.catch(() => {});
  const close = () => {
    if (instance) { const id = instance; instance = ""; void invoke("mini_app_close", {instance:id}).catch(() => {}); }
  };
  const invalidate = () => {
    invalid ??= new Error(`App access changed. Open the app again to continue ${purpose}.`);
    close(); rejectCancelled(invalid);
  };
  const assert = () => {
    if (invalid) throw invalid;
    signal?.throwIfAborted();
    assertStableApiSession(generation);
    if (readActiveSavedAccountSession()?.id !== account.id) throw new Error("The active account changed.");
  };
  let stopStore = () => {};
  let poll: ReturnType<typeof setInterval> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener(accountScopeResetEvent, invalidate);
  signal?.addEventListener("abort", invalidate, {once:true});
  try {
    assert();
    const installed = (await readInstallations(spaceId)).apps.find(app => app.app_id === appId && app.state === "installed");
    assert();
    if (!installed) throw new Error(`Add ${appId === "files" ? "Files" : "Library"} to this Space to use ${purpose}.`);
    const app = installed.release_metadata
      ? installedDevelopmentRelease(installed.release_metadata, useAppsStore.getState().catalog)
      : undefined;
    if (!app || app.id !== appId || app.version !== installed.installed_version || !app.desktop.sha256)
      throw new Error("Update this app to install its native services.");
    const session = await appsApi.createSession(appId, spaceId, installed.authority_generation);
    assert();
    if (session.app_id !== appId || session.space_id !== spaceId || capabilities.some(capability => !session.scopes.includes(capability) || !app.scopes.includes(capability)))
      throw new Error("This app session does not have file access.");
    const remaining = Date.parse(session.expires_at) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("The app session expired.");
    expiry = setTimeout(invalidate, Math.min(remaining, 2_147_483_647));
    const matches = (entry: typeof installed | undefined) => entry?.state === "installed" && entry.authority_generation === installed.authority_generation && entry.installed_version === installed.installed_version && capabilities.every(capability => entry.granted_scopes.includes(capability));
    stopStore = useAppsStore.subscribe(state => {
      try {
        assert();
        if (state.bySpace[spaceId] && !matches(state.bySpace[spaceId].find(app => app.app_id === appId))) invalidate();
      } catch { invalidate(); }
    });
    const revalidate = async () => {
      const current = (await readInstallations(spaceId)).apps.find(app => app.app_id === appId);
      assert();
      if (!matches(current)) { invalidate(); throw invalid; }
    };
    let polling = false;
    poll = setInterval(() => {
      if (polling) return;
      polling = true;
      void revalidate().catch(invalidate).finally(() => { polling = false; });
    }, 2000);
    if (!(await officialDesktopPackageReady(app, true))) {
      await installOfficialDesktopPackage(app, true);
      if (!(await officialDesktopPackageReady(app, true))) throw new Error("The native service package could not be verified.");
    }
    assert();
    const root = await invoke<string>("official_app_package_path", {pluginId:app.id,sha256:app.desktop.sha256});
    assert();
    const deployment = await resolveApiBase();
    assert();
    instance = await invoke<string>("mini_widget_open", {request:{root,owner:{accountId:account.id,spaceId,deployment,authorityGeneration:session.authority_generation},scopeLimit:capabilities}});
    assert();
    // The legacy caller resolves only files from a previously approved folder or
    // Library picker. This grant is confined to this one operation and released below.
    for (const capability of capabilities)
      await invoke("mini_app_permission_decide", {instance,capability,allowed:true});
    assert();
    const result = await Promise.race([run(instance), cancelled]);
    await revalidate();
    assert();
    return result;
  } finally {
    clearInterval(poll); clearTimeout(expiry); stopStore();
    window.removeEventListener(accountScopeResetEvent, invalidate);
    signal?.removeEventListener("abort", invalidate);
    close();
  }
}
