import type {
  ProviderConfigStep,
  ProviderWorkflow,
  ProviderWorkflowOption,
} from "@/native/contracts";
import type { ProviderConfigMode } from "@/native/contracts/primitives";

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
      .sort(
        (left, right) =>
          tokenPriority(left.key) - tokenPriority(right.key) || left.key.localeCompare(right.key),
      );
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

export function providerOptionsForConnection(
  session: ProviderConnectionLike,
  workflow: ProviderWorkflow | null,
): ProviderWorkflowOption[] {
  if (session.step?.option) return [session.step.option];
  if (isGoogleDriveProviderType(session.providerType)) {
    return googleDriveSetupOptions();
  }
  if (shouldUseOneDriveSetupOptions(session)) {
    return visibleOneDriveSetupOptions(session.parameters);
  }
  return workflow?.options ?? [];
}

export function isGoogleDriveProviderType(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "drive" || normalized === "googledrive";
}

export function isOneDriveProviderType(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("onedrive") || normalized.includes("microsoft365");
}

function shouldUseOneDriveSetupOptions(session: ProviderConnectionLike): boolean {
  return isOneDriveProviderType(session.providerType);
}

function googleDriveSetupOptions(): ProviderWorkflowOption[] {
  return [
    {
      name: "client_id",
      label: "Client ID",
      help: "Optional Google OAuth client ID. Leave blank to use the built-in OAuth app.",
      defaultValue: "",
      required: false,
      password: false,
      choices: [],
    },
    {
      name: "client_secret",
      label: "Client Secret",
      help: "Optional Google OAuth client secret. Leave blank to use the built-in OAuth app.",
      defaultValue: "",
      required: false,
      password: true,
      choices: [],
    },
  ];
}

function visibleOneDriveSetupOptions(parameters: Record<string, string>): ProviderWorkflowOption[] {
  const configType = parameters.config_type || "onedrive";
  const options = oneDriveSetupOptions();
  if (configType === "driveid") return options;
  return options.filter((option) => option.name !== "drive_id" && option.name !== "drive_type");
}

function oneDriveSetupOptions(): ProviderWorkflowOption[] {
  return [
    {
      name: "config_type",
      label: "Type of connection",
      help: "Choose the OneDrive account type Misty should configure.",
      defaultValue: "onedrive",
      required: true,
      password: false,
      choices: [
        { value: "onedrive", help: "OneDrive Personal or Business" },
        { value: "sharepoint", help: "Root SharePoint site" },
        { value: "driveid", help: "Enter drive ID manually" },
        { value: "search", help: "Search a SharePoint site" },
      ],
    },
    {
      name: "client_id",
      label: "Client ID",
      help: "Optional Microsoft OAuth client ID. Leave blank to use Misty's app.",
      defaultValue: "",
      required: false,
      password: false,
      choices: [],
    },
    {
      name: "client_secret",
      label: "Client Secret",
      help: "Optional Microsoft OAuth client secret. Leave blank to use Misty's app.",
      defaultValue: "",
      required: false,
      password: true,
      choices: [],
    },
    {
      name: "drive_id",
      label: "The ID of the drive to use",
      help: "Enter the drive ID Misty should save for this connection.",
      defaultValue: "",
      required: true,
      password: false,
      choices: [],
    },
    {
      name: "drive_type",
      label: "The type of the drive",
      help: "Choose the drive type: personal, business, or document library.",
      defaultValue: "",
      required: true,
      password: false,
      choices: [
        { value: "personal", help: "Personal drive" },
        { value: "business", help: "Business drive" },
        { value: "documentLibrary", help: "Document library" },
      ],
    },
  ];
}

function tokenPriority(key: string): number {
  if (key === "access_token") return 0;
  if (key === "refresh_token") return 1;
  if (key === "token_type") return 2;
  if (key === "expiry") return 3;
  if (key === "expires_in") return 4;
  return 5;
}

export type TokenField = {
  key: string;
  value: string;
  sensitive: boolean;
};

export interface ProviderConnectionLike {
  mode: ProviderConfigMode;
  providerType: string;
  parameters: Record<string, string>;
  step: ProviderConfigStep | null;
}
