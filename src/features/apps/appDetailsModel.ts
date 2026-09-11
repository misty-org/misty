import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { officialAppNeedsReview } from "./appInstallationStatus";

export function discoverAppName(app: OfficialApp) {
  return app.id === "chat" ? "Social" : app.name;
}

export function discoverAppAction(
  app: OfficialApp,
  installation: SpaceAppInstallation | undefined,
  mobile: boolean,
) {
  if ((mobile ? app.mobile : app.desktop).runtime === "unsupported") return "Unavailable";
  if (officialAppNeedsReview(app, installation)) return "Install";
  if (installation?.state === "installed") return "Uninstall";
  return "Install";
}

export function discoverAppPlatform(app: OfficialApp) {
  if (app.mobile.runtime === "unsupported") return "Desktop";
  if (app.desktop.runtime === "unsupported") return "iPhone and iPad";
  return "Desktop, iPhone, and iPad";
}

export function discoverAppSize(app: OfficialApp, mobile: boolean) {
  const bytes = (mobile ? app.mobile : app.desktop).download_bytes;
  if (!bytes) return "Download size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
