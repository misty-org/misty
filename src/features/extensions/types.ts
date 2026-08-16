export interface CatalogEntry {
  id: number;
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
  id: number;
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
  id: number;
  status: "enabled" | "disabled" | "needs-review" | "needs-attention";
  version: string | null;
  detail: string | null;
  review: ExtensionReview | null;
}
export interface ExtensionAction {
  id: string;
  title: string;
  badge: string;
  enabled: boolean;
  icon: string;
}
export interface CatalogPage {
  entries: CatalogEntry[];
  count: number;
  hasMore: boolean;
}
export interface ExtensionEvent {
  requestId?: string;
  generation?: string;
  windowId?: string;
  urls?: string[];
  tabs?: string[];
  focused?: boolean;
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
