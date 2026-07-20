import { isRememberableAppRoute } from "@/stores/app";

const videoWallpaperExtensions = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);

export function isVideoWallpaperPath(path: string): boolean {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? "";
  const extensionStart = cleanPath.lastIndexOf(".");
  if (extensionStart < 0) return false;
  return videoWallpaperExtensions.has(cleanPath.slice(extensionStart + 1).toLowerCase());
}

export function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function initialsForProfile(name: string, email: string): string {
  const initials = name
    .split(" ")
    .map((word) => word.trim()[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return initials || email[0]?.toUpperCase() || "M";
}

export function emailName(email: string): string | null {
  const name = email.split("@")[0]?.trim();
  return name || null;
}

export function settingsFallbackRoute(previousRoute: string, rememberedRoute: string): string {
  const candidates = [previousRoute, rememberedRoute, "/files"];
  return (
    candidates.find((route) => {
      if (!route || route.startsWith("/settings") || route === "/account") return false;
      return isRememberableAppRoute(route);
    }) ?? "/files"
  );
}
