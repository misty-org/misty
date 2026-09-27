/** Local paths and paired LAN devices are the only external Files locations. */
export function isRetiredCloudLocation(path: string, legacyMountRoot?: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.startsWith("misty://device/")) return false;
  if (normalized.startsWith("misty-remotes://")) return true;
  if (
    normalized.includes("://") &&
    ![
      "misty://local",
      "misty://recent",
      "misty://starred",
      "misty://trash",
      "misty://library",
      "misty-transfers://history",
    ].includes(normalized)
  )
    return true;
  const mount = legacyMountRoot?.replace(/\\/g, "/").replace(/\/+$/, "");
  return (
    Boolean(mount && (normalized === mount || normalized.startsWith(`${mount}/`))) ||
    /(?:^|\/)\.misty\/mnt(?:\/|$)/.test(normalized)
  );
}
