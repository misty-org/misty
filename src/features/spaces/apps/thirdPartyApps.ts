import catalog from "./catalog.json";

/** The wrapper Misty adds around a maker's own release when it installs it (`Wrap` in `apps/bundle.rs`). */
export interface AppWrap {
  manifest: Record<string, unknown>;
  add_copies: { from: string; to: string }[];
  strip_top: boolean;
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
  permissions: string[];
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
    wrap: { manifest: app.manifest, add_copies: app.add_copies, strip_top: app.strip_top },
  };
}
