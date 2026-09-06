import { ApiRequestError, apiRequest } from "@/api/client";
import type { Space } from "@/api/spaces/dto/interfaces/types";

export type MistyAppRuntime = "downloaded" | "hosted" | "embedded" | "unsupported";

export const OFFICIAL_APP_IDS = new Set([
  "chat",
  "journal",
  "planner",
  "library",
  "inbox",
  "agents",
  "files",
  "browser",
  "code",
  "terminal",
  "transfers",
]);

export interface OfficialApp {
  app_id?: string;
  slug?: string;
  id: string;
  name: string;
  publisher: "Misty";
  description: string;
  version: string;
  permission_version: number;
  minimum_host_protocol: number;
  minimum_host_version?: string;
  official: true;
  age_rating: string;
  scopes: string[];
  network_origins?: string[];
  desktop: {
    runtime: MistyAppRuntime;
    entry?: string;
    sha256?: string;
    signature?: string;
    signature_key_id?: string;
    download_bytes?: number;
    additional_storage_bytes?: number;
  };
  mobile: {
    runtime: MistyAppRuntime;
    entry?: string;
    sha256?: string;
    style_sha256?: string;
    signature?: string;
    signature_key_id?: string;
    download_bytes?: number;
    additional_storage_bytes?: number;
  };
}

export interface UserAppInstallation {
  app_id: string;
  state: "installed" | "recoverable" | "purging";
  installed_version: string;
  permission_version: number;
  granted_scopes: string[];
  pinned: boolean;
  pin_rank: number;
  installed_at: string;
  uninstalled_at?: string;
  data_deletion_at?: string;
  updated_at: string;
}

export interface OnboardingCompletion {
  space: Space;
  apps: UserAppInstallation[];
}

export interface OfficialAppSession {
  token: string;
  app_id: string;
  space_id?: string;
  scopes: string[];
  expires_at: string;
  sdk_base_url: string;
}

export interface OfficialAppRuntimeResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

export interface OfficialAppCatalogResponse {
  apps: OfficialApp[];
  host_protocol_version: number;
}

export class AppRequestError extends ApiRequestError {
  constructor(message: string, status: number, code?: string, responseText = "") {
    super(message, status, code, responseText);
    this.name = "AppRequestError";
  }
}

async function appRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiRequest<T>(path, init);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw new AppRequestError(
        appErrorMessage(error.code, error.message),
        error.status,
        error.code,
        error.responseText,
      );
    }
    throw error;
  }
}

export async function officialAppRuntimeRequest(input: {
  signal?: AbortSignal;
  appRuntimeBase: string;
  path: string;
  token: string;
  method: string;
  body?: string;
}): Promise<OfficialAppRuntimeResponse> {
  const recordPrefix = "/app-runtime/records";
  const isRecordRequest = input.path === recordPrefix || input.path.startsWith(`${recordPrefix}/`);
  const serverBase = input.appRuntimeBase.replace(/\/app-runtime$/, "");
  const response = await fetch(
    `${isRecordRequest ? input.appRuntimeBase : serverBase}${isRecordRequest ? input.path.slice("/app-runtime".length) : input.path}`,
    {
      method: input.method,
      signal: input.signal,
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${input.token}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.method === "GET" ? undefined : input.body,
    },
  );
  let data: unknown = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
  }
  return { ok: response.ok, status: response.status, data };
}

export function appErrorMessage(code: string | undefined, fallback: string): string {
  const messages: Record<string, string> = {
    app_not_found: "That app is no longer available from this Misty server.",
    app_not_installed: "Add this App to Misty before changing its settings.",
    app_data_purging: "This app’s private data is already being permanently deleted.",
    app_permissions_changed:
      "This app’s permissions changed. Refresh Discover and review them before adding it.",
    invalid_app_selection: "One of the selected apps is no longer available.",
    onboarding_already_complete: "This account has already finished setup.",
    onboarding_request_changed:
      "Setup already finished with different choices. Reload Misty to continue.",
  };
  return code && messages[code] ? messages[code] : fallback.trim() || "The app request failed.";
}

export function finishOnboarding(spaceName: string, appIds: string[]) {
  return appRequest<OnboardingCompletion>("/onboarding/finish", {
    method: "POST",
    body: JSON.stringify({ space_name: spaceName, app_ids: appIds }),
  });
}

function sameCatalogValues(left: string[] = [], right: string[] = []): boolean {
  const sortedRight = [...right].sort();
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === sortedRight[index])
  );
}

// The server issues installation grants. Local packages may replace artifact
// locations, but must never introduce a different release or permission contract.
function matchingDevelopmentApp(server: OfficialApp, local: OfficialApp): boolean {
  return (
    server.id === local.id &&
    server.official &&
    local.official &&
    server.publisher === local.publisher &&
    server.version === local.version &&
    server.permission_version === local.permission_version &&
    server.minimum_host_protocol === local.minimum_host_protocol &&
    sameCatalogValues(server.scopes, local.scopes) &&
    sameCatalogValues(server.network_origins, local.network_origins)
  );
}

export async function loadOfficialAppCatalog(
  localDevelopmentCatalog = import.meta.env.DEV &&
    import.meta.env.VITE_MISTY_LOCAL_OFFICIAL_APPS === "true",
): Promise<OfficialAppCatalogResponse> {
  const serverCatalog = await appRequest<OfficialAppCatalogResponse>("/apps");
  if (!localDevelopmentCatalog) return serverCatalog;

  try {
    const response = await fetch("/official-apps/catalog.json", {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return serverCatalog;
    const localCatalog = (await response.json()) as OfficialAppCatalogResponse;
    return {
      ...serverCatalog,
      apps: serverCatalog.apps.map((app) => {
        const local = localCatalog.apps.find((candidate) => matchingDevelopmentApp(app, candidate));
        if (!local) return app;
        return {
          ...app,
          desktop: app.desktop.runtime === "unsupported" ? app.desktop : local.desktop,
          mobile: app.mobile.runtime === "unsupported" ? app.mobile : local.mobile,
        };
      }),
    };
  } catch {
    // An optional local build must not prevent installing the server's release.
    return serverCatalog;
  }
}

export const appsApi = {
  catalog: loadOfficialAppCatalog,
  installations: () => appRequest<{ apps: UserAppInstallation[] }>("/me/apps"),
  install: (appId: string, permissionVersion: number) =>
    appRequest<UserAppInstallation>(`/me/apps/${encodeURIComponent(appId)}`, {
      method: "PUT",
      body: JSON.stringify({ permission_version: permissionVersion }),
    }),
  setPinned: (appId: string, pinned: boolean) =>
    appRequest<UserAppInstallation>(`/me/apps/${encodeURIComponent(appId)}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
  uninstall: (appId: string) =>
    appRequest<UserAppInstallation>(`/me/apps/${encodeURIComponent(appId)}`, {
      method: "DELETE",
    }),
  createSession: (appId: string, spaceId = "") =>
    appRequest<OfficialAppSession>(`/me/apps/${encodeURIComponent(appId)}/sessions`, {
      method: "POST",
      body: JSON.stringify({ space_id: spaceId }),
    }),
  finishOnboarding,
};
