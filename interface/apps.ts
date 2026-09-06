export const MISTY_APP_CATALOG_SCHEMA_VERSION = 1 as const;
export const MISTY_APP_HOST_PROTOCOL_VERSION = 2 as const;

export type MistyAppRuntime =
  "downloaded" | "hosted" | "embedded" | "unsupported";

export interface MistyAppPlatform {
  readonly runtime: MistyAppRuntime;
  readonly entry?: string;
  readonly sha256?: string;
  readonly style_sha256?: string;
  readonly signature?: string;
  readonly signature_key_id?: string;
  readonly download_bytes?: number;
  readonly additional_storage_bytes?: number;
}

export interface MistyAppNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly children?: readonly MistyAppNavigationItem[];
}

/** Transport-agnostic manifest consumed by a Misty Mini App runtime. */
export interface MiniAppManifest {
  /** Immutable reverse-domain identity. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Supported @misty/sdk range or protocol generation. */
  readonly sdk: string;
  readonly entry: string;
  readonly capabilities: readonly string[];
  readonly networkOrigins?: readonly string[];
}

export interface MistyOfficialApp {
  /** Immutable reverse-domain identity used for grants and storage namespaces. */
  readonly app_id?: string;
  /** Friendly stable route and catalog identifier. */
  readonly slug?: string;
  readonly id: string;
  readonly name: string;
  readonly publisher: "Misty";
  readonly description: string;
  readonly version: string;
  readonly permission_version: number;
  readonly minimum_host_protocol: number;
  readonly official: true;
  readonly age_rating: string;
  readonly scopes: readonly string[];
  readonly network_origins?: readonly string[];
  readonly navigation?: readonly MistyAppNavigationItem[];
  readonly universal_link?: string;
  readonly desktop: MistyAppPlatform;
  readonly mobile: MistyAppPlatform;
}

export interface MistyOfficialAppCatalog {
  readonly schema_version: typeof MISTY_APP_CATALOG_SCHEMA_VERSION;
  readonly host_protocol_version: typeof MISTY_APP_HOST_PROTOCOL_VERSION;
  readonly apps: readonly MistyOfficialApp[];
  readonly signing?: { readonly key_id: string; readonly public_key: string };
}

export function officialAppSupportsMobile(app: MistyOfficialApp): boolean {
  return app.mobile.runtime !== "unsupported";
}

export function officialAppSupportsDesktop(app: MistyOfficialApp): boolean {
  return app.desktop.runtime !== "unsupported";
}
