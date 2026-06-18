export type TokenField = {
  key: string;
  value: string;
  sensitive: boolean;
};

const preferredConfigKeys = [
  "root_folder_id",
  "scope",
  "client_id",
  "client_secret",
  "token",
  "drive_id",
  "drive_type",
  "service_account_file",
  "team_drive",
  "access_key_id",
  "secret_access_key",
  "endpoint",
  "region",
  "bucket",
  "root",
];

export function configPriority(key: string): number {
  const index = preferredConfigKeys.indexOf(key);
  return index === -1 ? preferredConfigKeys.length : index;
}

export function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return lowered.includes("secret") || lowered.includes("password") || lowered.includes("token");
}

export function stableConfig(config: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right))),
  );
}

export function parseTokenFields(tokenJson: string): TokenField[] {
  try {
    const parsed = JSON.parse(tokenJson) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return [];
    return Object.entries(parsed)
      .map(([key, value]) => ({
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        sensitive: key !== "token_type" && (key.includes("token") || key.includes("secret")),
      }))
      .sort((left, right) => tokenPriority(left.key) - tokenPriority(right.key) || left.key.localeCompare(right.key));
  } catch {
    return [];
  }
}

export function updateTokenField(tokenJson: string, key: string, value: string): string {
  try {
    const parsed = JSON.parse(tokenJson) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || !(key in parsed)) {
      return tokenJson;
    }
    const original = parsed[key];
    if (typeof original === "boolean") {
      parsed[key] = value === "true" ? true : value === "false" ? false : value;
    } else if (typeof original === "number") {
      const numeric = Number(value);
      parsed[key] = Number.isFinite(numeric) ? numeric : value;
    } else if (original && typeof original === "object") {
      try {
        parsed[key] = JSON.parse(value) as unknown;
      } catch {
        parsed[key] = value;
      }
    } else {
      parsed[key] = value;
    }
    return JSON.stringify(parsed);
  } catch {
    return tokenJson;
  }
}

function tokenPriority(key: string): number {
  if (key === "access_token") return 0;
  if (key === "refresh_token") return 1;
  if (key === "token_type") return 2;
  if (key === "expiry") return 3;
  if (key === "expires_in") return 4;
  return 5;
}
