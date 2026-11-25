import type { MarkRender } from "@misty/ui";
import { desktopOs } from "@/shared/platform/desktop_os";
import { useRegistry } from "@/native/registry";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";

export interface AppWrap {
  manifest: Record<string, unknown>;
  add_copies: { from: string; to: string }[];
  strip_top: boolean;
  auto_top?: boolean;
  add_files?: { path: string; url: string; sha256: string; size: number }[];
}

export interface CatalogApp extends AppWrap {
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
  useRegistry.getState().apps as readonly CatalogApp[];

export const useRegistryApps = (): readonly CatalogApp[] =>
  useRegistry((state) => state.apps) as readonly CatalogApp[];

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

export function appEntry(app: { app_id: string }): CatalogApp | undefined {
  return registryApps().find((entry) => entry.id === app.app_id);
}

export function runsHere(entry: CatalogApp): boolean {
  const platforms = entry.manifest.platforms;
  return !Array.isArray(platforms) || !platforms.length || platforms.includes(desktopOs());
}
