import { desktopOs } from "@/shared/platform/desktopOs";
import { useRegistry } from "@/native/registry";

export interface AppWrap {
  manifest: Record<string, unknown>;
  add_copies: { from: string; to: string }[];
  strip_top: boolean;
  auto_top?: boolean;
  add_files?: { path: string; content: string }[];
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
  return app.logo;
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
  | ({ result: "app" } & AppSource)
  | { result: "incompatible"; repo: string; reason: string };

export function appEntry(app: { app_id: string; source?: AppSource | null }): CatalogApp | undefined {
  return registryApps().find((entry) => entry.id === app.app_id) ?? app.source?.entry ?? undefined;
}

export function runsHere(entry: CatalogApp): boolean {
  const platforms = entry.manifest.platforms;
  return !Array.isArray(platforms) || !platforms.length || platforms.includes(desktopOs());
}

export function appHosts(entry: CatalogApp): { host: string; paid: boolean }[] {
  const network = entry.manifest.network;
  return Array.isArray(network)
    ? network.flatMap((item) =>
        item && typeof item === "object" && typeof (item as { host?: unknown }).host === "string"
          ? [{ host: (item as { host: string }).host, paid: (item as { paid?: unknown }).paid === true }]
          : [],
      )
    : [];
}
