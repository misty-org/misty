/** Per-site report of which website data synced and which was skipped. */
export type WebsiteDataKind = "cookies" | "local_storage" | "session_storage" | "indexed_db";
export type WebsiteDataSkipReason =
  | "partitioned"
  | "unsupported_attributes"
  | "not_supported_here"
  | "malformed"
  | "duplicate"
  | "unsupported_values"
  | "too_large"
  | "sync_limit"
  | "unreadable";

export interface WebsiteDataSite {
  site: string;
  synced: { kind: WebsiteDataKind; count: number }[];
  skipped: { kind: WebsiteDataKind; reason: WebsiteDataSkipReason; count: number }[];
}

export type DeviceDataState = "synced" | "publishing" | "loading" | "attention";

/** One device's (tree's) website data as seen by this session. */
export interface DeviceWebsiteData {
  device_id: string;
  state: DeviceDataState;
  sites: WebsiteDataSite[];
  checked_at: number;
}

export const deviceDataStateLabel: Record<DeviceDataState, string> = {
  synced: "Up to date",
  publishing: "Saving changes to this device",
  loading: "Loading this device’s sign-ins",
  attention: "Needs attention",
};

/** The device this session writes: the one it drives, or itself before trees. */
export function currentDeviceId(session: {
  device_id: string;
  trees?: { driving_tree: string | null } | null;
}) {
  return session.trees ? session.trees.driving_tree : session.device_id;
}

/** The written device first, then the rest in a stable order. */
export function orderedDeviceData(devices: DeviceWebsiteData[], current: string | null) {
  return [...devices].sort(
    (a, b) =>
      Number(b.device_id === current) - Number(a.device_id === current) ||
      a.device_id.localeCompare(b.device_id),
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function syncedLabel({ kind, count }: WebsiteDataSite["synced"][number]) {
  switch (kind) {
    case "cookies":
      return plural(count, "cookie", "cookies");
    case "local_storage":
      return `local storage (${plural(count, "item", "items")})`;
    case "session_storage":
      return `tab session data (${plural(count, "item", "items")})`;
    case "indexed_db":
      return plural(count, "database", "databases");
  }
}

const reasons: Record<WebsiteDataSkipReason, string> = {
  partitioned: "partitioned cookies can’t be copied between devices",
  unsupported_attributes: "uses browser settings that can’t be copied exactly",
  not_supported_here: "this device’s browser can’t store it, so it stays with your other devices",
  malformed: "the data is invalid",
  duplicate: "duplicates another cookie",
  unsupported_values: "contains values that can’t be copied",
  too_large: "too large to sync",
  sync_limit: "over the sync size limit",
  unreadable: "couldn’t be read this time; retrying automatically",
};

export function skippedLabel({ kind, reason, count }: WebsiteDataSite["skipped"][number]) {
  const what =
    kind === "cookies"
      ? plural(count, "cookie", "cookies")
      : kind === "indexed_db"
        ? plural(count, "database", "databases")
        : kind === "local_storage"
          ? "Local storage"
          : "Tab session data";
  return `${what}: ${reasons[reason]}`;
}

export function websiteDataSummary(sites: WebsiteDataSite[]) {
  const partial = sites.filter((site) => site.skipped.length > 0).length;
  if (!sites.length) return null;
  if (!partial) return `All website data on ${plural(sites.length, "site", "sites")} syncs`;
  return `Some data on ${plural(partial, "site", "sites")} can’t sync`;
}
