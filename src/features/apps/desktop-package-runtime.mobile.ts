import type { OfficialApp } from "@/api/apps";

export async function officialDesktopPackageReady(_app: OfficialApp): Promise<boolean> {
  return false;
}

export async function installOfficialDesktopPackage(_app: OfficialApp): Promise<void> {
  throw new Error("Downloaded desktop packages are unavailable on mobile.");
}

export async function stageOfficialDesktopPackage(_app: OfficialApp): Promise<string | null> {
  return null;
}

export async function finalizeOfficialDesktopPackageInstall(
  _appId: string,
  _operationId: string | null,
  _commit: boolean,
): Promise<void> {}

export async function uninstallOfficialDesktopPackage(_appId: string): Promise<void> {}
