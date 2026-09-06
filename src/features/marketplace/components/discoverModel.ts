import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { officialAppNeedsReview } from "@/features/apps/appInstallationStatus";

export type DiscoverSection = "featured" | "apps" | "installed";
export const discoverCategories = ["All Apps", "Creative", "Productivity", "Utilities"] as const;
export type DiscoverCategory = (typeof discoverCategories)[number];

export function discoverAppName(app: OfficialApp) {
  return app.id === "chat" ? "Social" : app.name;
}

export function discoverAppCategory(app: OfficialApp): DiscoverCategory {
  if (["journal", "library"].includes(app.id)) return "Creative";
  if (["chat", "planner", "inbox", "agents"].includes(app.id)) return "Productivity";
  return "Utilities";
}

export function discoverAppAction(
  app: OfficialApp,
  installation: UserAppInstallation | undefined,
  mobile: boolean,
) {
  if ((mobile ? app.mobile : app.desktop).runtime === "unsupported") return "Unavailable";
  if (officialAppNeedsReview(app, installation)) {
    return installation?.permission_version !== app.permission_version ||
      app.scopes.some((scope) => !installation?.granted_scopes.includes(scope))
      ? "Review"
      : "Update";
  }
  if (installation?.state === "installed") return "Open";
  return "Add";
}

export function discoverAppPlatform(app: OfficialApp) {
  if (app.mobile.runtime === "unsupported") return "Desktop";
  if (app.desktop.runtime === "unsupported") return "iPhone and iPad";
  return "Desktop, iPhone, and iPad";
}

export function discoverAppSize(app: OfficialApp, mobile: boolean) {
  const bytes = (mobile ? app.mobile : app.desktop).download_bytes;
  if (!bytes) return "Size shown before download";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
