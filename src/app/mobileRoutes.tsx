import type { LucideIcon } from "lucide-react";
import { Folder, PlugZap, Settings, UserCircle } from "lucide-react";
import { MobileDiagnosticsPage } from "../features/diagnostics/mobile/MobileDiagnosticsPage";
import { MobileFilesPage } from "../features/explorer/mobile/MobileFilesPage";
import { MobileDesktopRequiredPage } from "../features/mobile/MobileDesktopRequiredPage";
import { MobileAccountPage } from "../features/account/mobile/MobileAccountPage";
import { MobileProvidersPage } from "../features/providers/mobile/MobileProvidersPage";
import { MobileSettingsPage } from "../features/settings/mobile/MobileSettingsPage";
import type { AppTab } from "./types";

export type MobileRouteId = "files" | "account" | "providers" | "settings" | "diagnostics" | "desktop-required";

export interface MobileRouteDefinition {
  id: MobileRouteId;
  label: string;
  path: string;
  icon: LucideIcon;
  nav: boolean;
  element: JSX.Element;
}

export const mobileNavRoutes = [
  { id: "files", label: "Files", path: "/files", icon: Folder, nav: true, element: <MobileFilesPage /> },
  { id: "providers", label: "Remotes", path: "/providers", icon: PlugZap, nav: true, element: <MobileProvidersPage /> },
  { id: "account", label: "Account", path: "/account", icon: UserCircle, nav: true, element: <MobileAccountPage /> },
  { id: "settings", label: "Settings", path: "/account/settings", icon: Settings, nav: false, element: <MobileSettingsPage /> },
  { id: "diagnostics", label: "Diagnostics", path: "/diagnostics", icon: Settings, nav: false, element: <MobileDiagnosticsPage /> },
] satisfies MobileRouteDefinition[];

export const mobileAllowedRoutes = new Set(mobileNavRoutes.map((route) => route.path));
export const mobileLastRouteStorageKey = "misty.mobile.lastRoute";

export function mobileRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith("/providers")) return "providers";
  if (pathname.startsWith("/account")) return "account";
  if (pathname.startsWith("/settings")) return "account";
  if (pathname.startsWith("/diagnostics")) return "diagnostics";
  return "files";
}

export function safeMobileRoute(pathname: string): string {
  return mobileAllowedRoutes.has(pathname) ? pathname : "/files";
}

export function desktopRequiredElement(feature: string) {
  return <MobileDesktopRequiredPage feature={feature} />;
}
