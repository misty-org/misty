import { localDesktopComponentUrl } from "./localDesktopApp";
import { localAppComponentReady } from "@/api/apps/api";
import { assertAppCompatible } from "./appCompatibility";
import type { OfficialApp } from "@/api/apps";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";

interface LocalAppRecord {
  id: string;
  root: string;
}

export async function officialDesktopPackageReady(app: OfficialApp): Promise<boolean> {
  if (!hasTauriInternals() || app.desktop.runtime !== "downloaded") return false;
  const local = localDesktopComponentUrl(app);
  if (local) return localAppComponentReady(local);
  const sha256 = app.desktop.sha256?.trim();
  const signature = app.desktop.signature?.trim();
  const signatureKeyId = app.desktop.signature_key_id?.trim();
  if (!sha256 || !signature || !signatureKeyId) return false;
  return invoke<boolean>("official_app_package_ready", {
    pluginId: app.id,
    version: app.version,
    sha256,
    signature,
    signatureKeyId,
  });
}

export async function stageOfficialDesktopPackage(app: OfficialApp): Promise<string | null> {
  if (!hasTauriInternals() || app.desktop.runtime !== "downloaded") return null;
  assertAppCompatible(app);
  if (localDesktopComponentUrl(app)) {
    if (!(await officialDesktopPackageReady(app)))
      throw new Error(`Build ${app.name} in the local Apps repository first.`);
    return null;
  }
  const entry = app.desktop.entry?.trim();
  const sha256 = app.desktop.sha256?.trim();
  const signature = app.desktop.signature?.trim();
  const signatureKeyId = app.desktop.signature_key_id?.trim();
  if (!entry || !sha256 || !signature || !signatureKeyId) {
    throw new Error(`${app.name} does not have a complete signed desktop package.`);
  }
  return invoke<string>("install_plugin_bundle", {
    pluginId: app.id,
    root: "public",
    url: entry,
    platform: "desktop-web",
    sha256,
    official: true,
    version: app.version,
    signature,
    signatureKeyId,
  });
}

export async function finalizeOfficialDesktopPackageInstall(
  appId: string,
  operationId: string | null,
  commit: boolean,
): Promise<void> {
  if (!hasTauriInternals() || !operationId) return;
  await invoke<void>("finalize_official_app_install", { pluginId: appId, operationId, commit });
}

export async function installOfficialDesktopPackage(app: OfficialApp): Promise<void> {
  const operationId = await stageOfficialDesktopPackage(app);
  await finalizeOfficialDesktopPackageInstall(app.id, operationId, true);
}

export async function uninstallOfficialDesktopPackage(
  appId: string,
  assertCurrent: () => void = () => undefined,
): Promise<void> {
  assertCurrent();
  if (!hasTauriInternals()) return;
  const records = await invoke<LocalAppRecord[]>("scan_local_plugins");
  assertCurrent();
  if (!records.some((record) => record.id === appId && record.root === "public")) return;
  await invoke<string>("uninstall_plugin", { pluginId: appId, root: "public" });
}
