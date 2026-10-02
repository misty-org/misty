import { isRememberableAppRoute } from "@/features/app-shell";

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
  const candidates = [previousRoute, rememberedRoute, "/browser"];
  return (
    candidates.find((route) => {
      if (!route || route.startsWith("/settings")) return false;
      if (route === "/account" || route.startsWith("/providers")) return false;
      return isRememberableAppRoute(route);
    }) ?? "/browser"
  );
}
