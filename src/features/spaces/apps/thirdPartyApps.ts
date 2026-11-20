import { desktopOs } from "@/shared/platform/desktopOs";
import catalog from "./catalog.json";

/** The wrapper Misty adds around a maker's own release when it installs it (`Wrap` in `apps/bundle.rs`). */
export interface AppWrap {
  manifest: Record<string, unknown>;
  add_copies: { from: string; to: string }[];
  strip_top: boolean;
  /** The release's layout isn't known ahead: a single top folder is stripped when there is one. */
  auto_top?: boolean;
  /** Files Misty adds beside the release, such as an adapter script from misty-apps (`mcp: adapter`). */
  add_files?: { path: string; content: string }[];
}

/** An open-source app Misty offers to add to a Space, as `misty-apps` pins it to its maker's own release. */
export interface CatalogApp extends AppWrap {
  id: string;
  name: string;
  description?: string;
  maker: string;
  /** The maker's repository, `owner/name`. */
  upstream: string;
  license: string;
  version: string;
  /** The address of the maker's own release zip: nothing of theirs is hosted by Misty. */
  url: string;
  /** The checksum of that zip as the maker released it. */
  sha256: string;
  size: number;
  /** The maker's own icon, in their repository. */
  logo: string;
  /** The wide picture the maker exports for Explore: its featured card and the top of its details. Optional. */
  banner?: string;
  /** Pictures of the app at work, shown in its details. Optional. */
  screenshots?: string[];
  permissions: string[];
  /**
   * The app's MCP server as its maker's own program, per platform. Native code reads it from its own copy of this
   * catalog and runs it (`src-tauri/features/apps/program.rs`); here it only says the app has one.
   */
  mcp_program?: {
    program: string;
    builds: Record<string, { url: string; sha256: string; size: number }>;
  };
}

/**
 * The third-party apps a mod can add. Misty carries the pins with its own release: `catalog.json` here is a copy of
 * misty-apps', which names each app's maker, the version pinned and the maker's own release to download and check.
 */
export const catalogApps = catalog.apps as readonly CatalogApp[];

/** The address of a catalog app's own icon, loaded from its maker's repository. */
export function catalogLogoUrl(app: Pick<CatalogApp, "logo">): string {
  return app.logo;
}

/** What the host needs to fetch and wrap an app the first time it opens: the maker's zip, its checksum, the wrapper. */
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

/** Where an app's entry came from (`apps/resolve.rs`): Misty's reviewed catalog, its maker, or the basic check. */
export type ManifestFrom = "reviewed" | "maker" | "basic";

/** The pinned build of an app a mod added by its link, kept with the Space's app so every member gets the same. */
export interface AppSource {
  repo: string;
  listed: boolean;
  manifest_from: ManifestFrom;
  entry: CatalogApp;
}

/** What a pasted GitHub link resolved to (`space_app_resolve`). */
export type ResolvedLink =
  | ({ result: "app" } & AppSource)
  | { result: "incompatible"; repo: string; reason: string };

/**
 * An added app's entry: the catalog's, when Misty lists it, else the pin the mod's link made. The catalog wins, so a
 * listed app always runs at the version Misty reviewed.
 */
export function appEntry(app: { app_id: string; source?: AppSource | null }): CatalogApp | undefined {
  return catalogApps.find((entry) => entry.id === app.app_id) ?? app.source?.entry ?? undefined;
}

/** Whether an app runs on this computer: its manifest lists no platforms, or this one. */
export function runsHere(entry: CatalogApp): boolean {
  const platforms = entry.manifest.platforms;
  return !Array.isArray(platforms) || !platforms.length || platforms.includes(desktopOs());
}

/** The hosts an app may reach, from its manifest, for the mod to see before adding it. */
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
