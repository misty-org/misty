import type { TransferProfileOptions } from "@/models/interfaces/services/misty-api";

export const BUILT_IN_TRANSFER_PROFILE_IDS = new Set([
  "balanced",
  "low-bandwidth",
  "many-small-files",
  "careful-verify",
]);

export function transferProfileRecords(document: Record<string, unknown>): TransferProfileRecord[] {
  const profiles = sectionRecord(document, "transfer_profiles").profiles;
  if (!Array.isArray(profiles)) return [];
  return profiles
    .filter(
      (profile): profile is Record<string, unknown> =>
        profile != null && typeof profile === "object" && !Array.isArray(profile),
    )
    .map((profile) => {
      const id = typeof profile.id === "string" ? profile.id : "";
      return {
        id,
        name: typeof profile.name === "string" ? profile.name : "Profile",
        transfers: numberField(profile, "transfers", 4),
        checkers: numberField(profile, "checkers", 8),
        bandwidthLimit: typeof profile.bandwidth_limit === "string" ? profile.bandwidth_limit : "",
        retries: numberField(profile, "retries", 3),
        lowLevelRetries: numberField(profile, "low_level_retries", 10),
        checksum: typeof profile.checksum === "boolean" ? profile.checksum : false,
        builtIn: BUILT_IN_TRANSFER_PROFILE_IDS.has(id),
      };
    })
    .filter((profile) => profile.id);
}

export function defaultTransferProfile(document: Record<string, unknown>): TransferProfileRecord {
  const profiles = transferProfileRecords(document);
  const defaultId = defaultTransferProfileId(document);
  return (
    profiles.find((profile) => profile.id === defaultId) ?? profiles[0] ?? fallbackTransferProfile()
  );
}

export function defaultTransferProfileId(document: Record<string, unknown>): string {
  const value = sectionRecord(document, "transfer_profiles").default_profile_id;
  return typeof value === "string" ? value : "balanced";
}

export function transferProfileOptions(profile: TransferProfileRecord): TransferProfileOptions {
  return {
    transfers: profile.transfers,
    checkers: profile.checkers,
    bandwidthLimit: profile.bandwidthLimit,
    retries: profile.retries,
    lowLevelRetries: profile.lowLevelRetries,
    checksum: profile.checksum,
  };
}

function numberField(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sectionRecord(
  document: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const value = document[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fallbackTransferProfile(): TransferProfileRecord {
  return {
    id: "balanced",
    name: "Balanced",
    transfers: 4,
    checkers: 8,
    bandwidthLimit: "",
    retries: 3,
    lowLevelRetries: 10,
    checksum: false,
    builtIn: true,
  };
}

export interface TransferProfileRecord {
  id: string;
  name: string;
  transfers: number;
  checkers: number;
  bandwidthLimit: string;
  retries: number;
  lowLevelRetries: number;
  checksum: boolean;
  builtIn: boolean;
}
