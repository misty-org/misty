import type { MarkRender } from "@misty/ui";
import { desktopOs } from "@/shared/platform/desktop_os";
import { useRegistry } from "@/native/registry";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";

export interface AppWrap {
  manifest: Record<string, unknown>;
  add_copies: { from: string; to: string }[];
  strip_top: boolean;
  auto_top?: boolean;
  add_files?: { path: string; content: string }[];
}

export interface SiteMediaCheck {
  drm: boolean;
}

export interface CatalogApp extends AppWrap {
  kind?: "site";
  address?: string;
  origins?: string[];
  media?: Partial<Record<"macos" | "windows" | "linux", SiteMediaCheck>>;
  id: string;
  name: string;
  description?: string;
  maker: string;
  upstream: string;
  license: string;
  version: string;
  url: string;
  sha256: string;
  size: number;
  logo: string;
  icon_render?: MarkRender;
  banner?: string;
  screenshots?: string[];
  permissions: string[];
  mcp_program?: {
    program: string;
    builds: Record<string, { url: string; sha256: string; size: number }>;
  };
}

export const registryApps = (): readonly CatalogApp[] =>
  useRegistry.getState().apps.apps as readonly CatalogApp[];

export const useRegistryApps = (): readonly CatalogApp[] =>
  useRegistry((state) => state.apps.apps) as readonly CatalogApp[];

export function catalogLogoUrl(app: Pick<CatalogApp, "logo">): string {
  if (!app.logo.startsWith("https://")) return app.logo;
  const local = safeTauriAssetUrl("logo", "misty-logo");
  if (local === "logo") return app.logo;
  return `${local}?${new URLSearchParams({ u: app.logo }).toString()}`;
}

export function catalogSource(app: CatalogApp) {
  return {
    url: app.url,
    sha256: app.sha256,
    wrap: {
      manifest: app.manifest,
      add_copies: app.add_copies,
      strip_top: app.strip_top,
      auto_top: app.auto_top ?? false,
      add_files: app.add_files ?? [],
    },
  };
}

export type ManifestFrom = "reviewed" | "maker" | "basic";

export interface AppSource {
  repo: string;
  listed: boolean;
  manifest_from: ManifestFrom;
  entry: CatalogApp;
}

export type ResolvedLink =
  ({ result: "app" } & AppSource) | { result: "incompatible"; repo: string; reason: string };

export function appEntry(app: {
  app_id: string;
  source?: AppSource | null;
}): CatalogApp | undefined {
  return registryApps().find((entry) => entry.id === app.app_id) ?? app.source?.entry ?? undefined;
}

export const isSiteApp = (entry: CatalogApp): boolean => entry.kind === "site";

export function runsHere(entry: CatalogApp): boolean {
  const platforms = entry.manifest.platforms;
  const listed = !Array.isArray(platforms) || !platforms.length || platforms.includes(desktopOs());
  if (!isSiteApp(entry)) return listed;
  const os = desktopOs() as "macos" | "windows" | "linux";
  return listed && entry.media?.[os]?.drm === false;
}

export function siteManifest(entry: CatalogApp) {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    logo: entry.logo,
    entry: "",
    opens: [],
    permissions: entry.permissions,
    mcp: entry.manifest.mcp === "adapter" ? ("adapter" as const) : undefined,
    webview: false,
    platforms: entry.manifest.platforms as ("macos" | "windows" | "linux")[] | undefined,
  };
}

export function siteHost(entry: CatalogApp): string {
  try {
    return new URL(entry.address ?? "").host;
  } catch {
    return "";
  }
}

export function appHosts(entry: CatalogApp): { host: string; paid: boolean }[] {
  const network = entry.manifest.network;
  return Array.isArray(network)
    ? network.flatMap((item) =>
        item && typeof item === "object" && typeof (item as { host?: unknown }).host === "string"
          ? [
              {
                host: (item as { host: string }).host,
                paid: (item as { paid?: unknown }).paid === true,
              },
            ]
          : [],
      )
    : [];
}
