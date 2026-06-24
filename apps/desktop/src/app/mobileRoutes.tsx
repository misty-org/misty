import type { LucideIcon } from "lucide-react";
import { ArrowRightLeft, Blocks, Folder, PlugZap, UserCircle } from "lucide-react";
import { MobileFilesPage } from "../features/explorer/mobile/MobileFilesPage";
import { MobileHubPage } from "../features/hub/mobile/MobileHubPage";
import { MobileDesktopRequiredPage } from "../features/mobile/MobileDesktopRequiredPage";
import { MobileAccountPage } from "../features/account/mobile/MobileAccountPage";
import { MobileProvidersPage } from "../features/providers/mobile/MobileProvidersPage";
import { MobileTransfersPage } from "../features/transfers/mobile/MobileTransfersPage";
import type { AppTab } from "./types";

export type MobileRouteId = "files" | "transfers" | "hub" | "account" | "providers" | "desktop-required";

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
  { id: "transfers", label: "Transfers", path: "/transfers", icon: ArrowRightLeft, nav: true, element: <MobileTransfersPage /> },
  { id: "providers", label: "Providers", path: "/providers", icon: PlugZap, nav: true, element: <MobileProvidersPage /> },
  { id: "hub", label: "Hub", path: "/hub", icon: Blocks, nav: true, element: <MobileHubPage /> },
  { id: "account", label: "Account", path: "/account", icon: UserCircle, nav: true, element: <MobileAccountPage /> },
] satisfies MobileRouteDefinition[];

export const mobileAllowedRoutes = new Set(mobileNavRoutes.map((route) => route.path));
export const mobileLastRouteStorageKey = "misty.mobile.lastRoute";

export function mobileRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith("/transfers")) return "transfers";
  if (pathname.startsWith("/providers")) return "providers";
  if (pathname.startsWith("/hub")) return "hub";
  if (pathname.startsWith("/account")) return "account";
  return "files";
}

export function safeMobileRoute(pathname: string): string {
  return mobileAllowedRoutes.has(pathname) ? pathname : "/files";
}

export function desktopRequiredElement(feature: string) {
  return <MobileDesktopRequiredPage feature={feature} />;
}
