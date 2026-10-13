/** Where an extension installs from. */
export type ExtensionStore = "firefox" | "chrome";
/** One extension's current package, as its store describes it. */
export interface CatalogEntry {
  /** A Firefox Add-ons ID (digits) or a Chrome Web Store ID (32 letters a–p). */
  id: string;
  store: ExtensionStore;
  guid: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  authors: string[];
  iconUrl: string;
  version: string;
  users: number;
  rating: number;
  sourceUrl: string;
  downloadUrl: string;
  digest: string;
}
export interface Installation {
  id: string;
  guid: string;
  generation: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  privateAccess: boolean;
  agentAccess: boolean;
  permissions: string[];
  hosts: string[];
}
export interface ExtensionReview {
  token: string;
  entry: CatalogEntry;
  permissions: string[];
  hosts: string[];
  optionalPermissions: string[];
  optionalHosts: string[];
  findings: string[];
  blocked: boolean;
  privateAllowed: boolean;
  hasOptions: boolean;
  manifestVersion: number;
}
export interface InstalledState {
  id: string;
  status: "enabled" | "disabled" | "needs-review" | "needs-attention";
  version: string | null;
  detail: string | null;
  review: ExtensionReview | null;
  /** The page new tabs open while this extension runs, if it replaces it. */
  newTab?: string | null;
}
export interface ExtensionAction {
  id: string;
  title: string;
  badge: string;
  enabled: boolean;
  icon: string;
}
export interface ExtensionEvent {
  requestId?: string;
  generation?: string;
  windowId?: string;
  urls?: string[];
  tabs?: string[];
  focused?: boolean;
  /** open-window: a small floating page of the given size, as Chrome opens popup windows. */
  popup?: boolean;
  width?: number;
  height?: number;
  name?: string;
  index?: number;
  account: string;
  kind: string;
  id?: string | number;
  url?: string;
  tabId?: string;
  private?: boolean;
  guid?: string;
  permissions?: string[];
  hosts?: string[];
  detail?: string;
  /** compat-request: the extension API method and its arguments. */
  method?: string;
  args?: unknown[];
  privateAccess?: boolean;
  /** tab-muted */
  muted?: boolean;
}

export interface ExtensionCapabilities {
  minimumOS: string;
  platform: string;
  manifestVersions: number[];
  acquisition: string[];
  knownUnavailable: string[];
  /** Permissions that work with documented limits. */
  limited: string[];
  /** Namespaces Misty provides on top of the system runtime. */
  compatibilityLayer: string[];
  hostLimitations: string[];
  compatibility: string;
  runtimeCount: number;
  bridgeViewCount: number;
}
