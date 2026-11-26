import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type SitePermissionKind = "camera" | "microphone" | "location";

export interface WebPermissionAsk {
  id: string;
  page: string;
  origin: string;
  kinds: SitePermissionKind[];
}

export const sitePermissionKinds: SitePermissionKind[] = ["camera", "microphone", "location"];

export const sitePermissionName: Record<SitePermissionKind, string> = {
  camera: "Camera",
  microphone: "Microphone",
  location: "Location",
};

export const useWebPermissionAsks = create<{ asks: WebPermissionAsk[] }>(() => ({ asks: [] }));

export function addPermissionAsk(ask: WebPermissionAsk) {
  useWebPermissionAsks.setState((state) => ({ asks: [...state.asks, ask] }));
}

export function answerPermission(id: string, allow: boolean, remember: boolean) {
  useWebPermissionAsks.setState((state) => ({ asks: state.asks.filter((ask) => ask.id !== id) }));
  void invoke("browser_site_permission_answer", { request: { id, allow, remember } }).catch(
    () => undefined,
  );
}

export function dropPermissionAsks(page: string) {
  for (const ask of useWebPermissionAsks.getState().asks)
    if (ask.page === page) answerPermission(ask.id, false, false);
}

export function askedFor(kinds: SitePermissionKind[]): string {
  if (kinds.length === 1 && kinds[0] === "location") return "know your location";
  const said = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}` : kinds[0];
  return `use your ${said}`;
}

export type SitePermissions = Partial<Record<SitePermissionKind, boolean>>;

export function readSitePermissions(origin: string): Promise<SitePermissions> {
  return invoke<SitePermissions>("browser_site_permissions", { request: { origin } }).catch(
    () => ({}),
  );
}

export function setSitePermission(
  origin: string,
  kind: SitePermissionKind,
  allow: boolean | null,
): Promise<void> {
  return invoke("browser_site_permission_set", { request: { origin, kind, allow } });
}
