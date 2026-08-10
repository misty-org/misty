import type { AccountMeResponse } from "@/features/auth";
import { accountFetchMe } from "@/features/auth";
import { cloudConnectionsSnapshot, cloudConnectionToken } from "@/features/cloud";
import type { CurrentLicense } from "@/features/installer";
import { useSetupStore } from "@/features/installer";
import { providersImportCloudConnection } from "@/services/backend";
import type { ProviderRemote, ProviderWorkflow } from "@/services/misty/model/misty-api";
import type { ProviderConfigMode } from "@/services/misty/model/types/misty-api";
import { errorText } from "@/shared/lib/format";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProviderConnectionSession,
  ProvidersStore,
} from "../model/stores/providers/interfaces/useProvidersStore";
import { isOneDriveProviderType, providerOptionsForConnection } from "../providerUtils";

const PROVIDER_AUTH_TIMEOUT_MS = 3 * 60 * 1000;
let connectionGeneration = 0;
let cloudLeaseRefreshTimer: number | null = null;

export function currentConnectionGeneration(): number {
  return connectionGeneration;
}
export function nextConnectionGeneration(): number {
  connectionGeneration += 1;
  return connectionGeneration;
}
export function providerAuthorizationTimeoutMs(): number {
  return PROVIDER_AUTH_TIMEOUT_MS;
}

export function createConnectionSession(
  mode: ProviderConfigMode,
  remote?: ProviderRemote,
): ProviderConnectionSession {
  return {
    mode,
    stage: mode === "add" ? "provider" : "configure",
    providerType: remote?.type ?? "",
    remoteName: remote?.name ?? "",
    parameters: {},
    step: null,
    inFlight: false,
    polling: false,
    openedAuthorizeUrl: null,
    authorizeOpenAttempts: 0,
    authorizeOpenResult: null,
    authorizeOpenError: null,
    authPollAttempts: 0,
    authDeadlineMs: null,
    error: null,
  };
}

export async function validateCanAddRemote(_remotes: ProviderRemote[]): Promise<string | null> {
  const license = await fetchVerifiedLicenseForRemoteGate();
  if (!license) {
    return "Sign in to Misty before adding a remote.";
  }
  if (!licenseAllowsRemoteManagement(license)) {
    return "Your Misty license is not active. Update your account before adding a remote.";
  }
  return null;
}

export async function fetchVerifiedLicenseForRemoteGate(): Promise<CurrentLicense | null> {
  const setup = useSetupStore.getState();
  if (!setup.status) {
    await setup.loadSystem();
  }

  const me = await accountFetchMe();
  const license = licenseFromAccountMe(me);
  if (hasTauriInternals()) {
    await invoke("save_verified_license", { license });
    await useSetupStore.getState().loadSystem();
  }
  return license;
}

export function licenseFromAccountMe(me: AccountMeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

export function licenseAllowsRemoteManagement(license: CurrentLicense): boolean {
  return license.allows_use && (license.status === "active" || license.status === "trialing");
}

export async function refreshCloudConnectionLeases(): Promise<void> {
  if (!hasTauriInternals()) return;
  try {
    const snapshot = await cloudConnectionsSnapshot();
    await Promise.all(
      snapshot.connections.map(async (connection) => {
        const lease = await cloudConnectionToken(connection.id);
        await providersImportCloudConnection({
          name: connection.name,
          providerType: connection.provider,
          connectionId: connection.id,
          accessToken: lease.access_token,
        });
      }),
    );
  } catch {
    // Signed-out and offline users retain their last local connection metadata.
  }
}

export function scheduleCloudLeaseRefresh(): void {
  if (cloudLeaseRefreshTimer != null || typeof window === "undefined") return;
  cloudLeaseRefreshTimer = window.setInterval(
    () => void refreshCloudConnectionLeases(),
    45 * 60 * 1_000,
  );
}

export function providerConnectionErrorText(error: unknown, polling: boolean): string {
  const message = errorText(error);
  if (!polling) return message;
  if (isRecoverableAuthPollingError(error)) {
    return "Still waiting for provider authorization. Complete the browser sign-in, then return to Misty.";
  }
  return message;
}

export function nextConnectionAfterProviderError(
  connection: ProviderConnectionSession,
  error: unknown,
  polling: boolean,
): ProviderConnectionSession {
  const authPollAttempts = polling ? connection.authPollAttempts + 1 : connection.authPollAttempts;
  const authPollingTimedOut = polling && isProviderAuthorizationExpired(connection);
  const recoverablePolling =
    polling && isRecoverableAuthPollingError(error) && !authPollingTimedOut;
  return {
    ...connection,
    stage: polling && connection.step ? "authorize" : connection.stage,
    inFlight: false,
    polling: recoverablePolling,
    authPollAttempts,
    error: authPollingTimedOut
      ? providerAuthorizationTimedOutMessage()
      : providerConnectionErrorText(error, polling),
  };
}

export function providerAuthorizationTimedOutMessage(): string {
  return "Provider authorization timed out after 3 minutes. Misty canceled the sign-in session; start Configure again when you're ready.";
}

export function providerAuthorizationPollDelay(pollAfterMs?: number): number {
  const requested = pollAfterMs && pollAfterMs > 0 ? pollAfterMs : 750;
  return Math.min(Math.max(500, requested), 1500);
}

export function providerFlowSuccessSuffix(mode: ProviderConfigMode): string {
  if (mode === "repair") return "configured.";
  return "connected.";
}

export function isProviderAuthorizationExpired(session: ProviderConnectionSession): boolean {
  return (
    session.stage === "authorize" &&
    session.authDeadlineMs != null &&
    Date.now() >= session.authDeadlineMs
  );
}

export function scheduleProviderAuthorizationTimeout(
  get: () => ProvidersStore,
  set: ProvidersSet,
  generation: number,
  deadlineMs: number,
): void {
  window.setTimeout(
    () => {
      if (generation === connectionGeneration) {
        void expireProviderAuthorization(get, set, generation);
      }
    },
    Math.max(0, deadlineMs - Date.now()),
  );
}

export async function expireProviderAuthorization(
  get: () => ProvidersStore,
  set: ProvidersSet,
  generation: number,
): Promise<void> {
  const session = get().connection;
  if (generation !== connectionGeneration || !session || !isProviderAuthorizationExpired(session))
    return;
  connectionGeneration += 1;
  set({
    connection: {
      ...session,
      inFlight: false,
      polling: false,
      error: providerAuthorizationTimedOutMessage(),
    },
  });
  await cancelProviderAuthorization(session);
}

export async function cancelProviderAuthorization(
  session: ProviderConnectionSession | null,
): Promise<void> {
  if (
    !session ||
    session.stage !== "authorize" ||
    !session.providerType ||
    !session.remoteName.trim()
  )
    return;
  // Server-held OAuth states expire automatically and contain no file data.
}

export function isRecoverableAuthPollingError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("authorization") ||
    message.includes("oauth") ||
    message.includes("token") ||
    message.includes("auth header") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  );
}

export function workflowForType(
  workflows: ProviderWorkflow[],
  providerType: string,
): ProviderWorkflow | null {
  const normalized = providerType.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    workflows.find((workflow) => workflow.type === providerType) ??
    workflows.find((workflow) => {
      const type = workflow.type.toLowerCase().replace(/[^a-z0-9]/g, "");
      const name = workflow.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (
        type === normalized ||
        name === normalized ||
        type.includes(normalized) ||
        normalized.includes(type)
      );
    }) ??
    null
  );
}

export function defaultParametersForSession(
  session: ProviderConnectionSession,
  workflow: ProviderWorkflow | null,
): Record<string, string> {
  const options = providerOptionsForConnection(session, workflow);
  return Object.fromEntries(
    options.map((option) => [option.name, defaultProviderOptionValue(option)]),
  );
}

export function defaultProviderOptionValue(option: {
  name: string;
  defaultValue: string;
  choices: Array<{ value: string }>;
}): string {
  return normalizeProviderParameterValue(
    option.name,
    option.defaultValue || option.choices[0]?.value || "",
  );
}

export function nextConnectionParameters(
  session: ProviderConnectionSession,
  key: string,
  value: string,
): Record<string, string> {
  const parameters = {
    ...session.parameters,
    [key]: normalizeProviderParameterValue(key, value),
  };
  if (
    isOneDriveProviderType(session.providerType) &&
    key === "config_type" &&
    value !== "driveid"
  ) {
    delete parameters.drive_id;
    delete parameters.drive_type;
    delete parameters.config_driveid;
    delete parameters.config_driveid_fixed;
  }
  return parameters;
}

export function normalizeProviderParameters(
  parameters: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [
      key,
      normalizeProviderParameterValue(key, value),
    ]),
  );
}

export function normalizeProviderParametersForSession(
  session: ProviderConnectionSession,
): Record<string, string> {
  const parameters = normalizeProviderParameters(session.parameters);
  if (!isOneDriveProviderType(session.providerType)) return parameters;

  const configType = parameters.config_type || "onedrive";
  if (configType !== "driveid") {
    delete parameters.drive_id;
    delete parameters.drive_type;
    delete parameters.config_driveid;
    delete parameters.config_driveid_fixed;
    return parameters;
  }

  const driveID =
    parameters.drive_id || parameters.config_driveid_fixed || parameters.config_driveid || "";
  if (driveID.trim()) {
    parameters.config_driveid_fixed = driveID.trim();
    parameters.config_driveid = driveID.trim();
  }
  delete parameters.drive_id;
  delete parameters.drive_type;
  return parameters;
}

export function normalizeProviderParameterValue(key: string, value: string): string {
  if (isOAuthCredentialOptionName(key)) return value.trim();
  return value;
}

export function isOAuthCredentialOptionName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "clientid" || normalized === "clientsecret";
}

export function validateConnectionSession(
  session: ProviderConnectionSession,
  workflows: ProviderWorkflow[],
): string | null {
  if (!session.providerType) return "Choose a provider.";
  const name = session.remoteName.trim();
  if (!name) return "Enter a remote name.";
  if (name.includes(":") || name.includes("/") || name.includes("\\")) {
    return "Remote names cannot contain colons or path separators.";
  }
  const workflow = workflowForType(workflows, session.providerType);
  const options = providerOptionsForConnection(session, workflow);
  const missing = options.find(
    (option) => option.required && !(session.parameters[option.name] ?? "").trim(),
  );
  return missing ? `${missing.label || missing.name} is required.` : null;
}

export type ProvidersGet = () => ProvidersStore;

export type ProvidersSet = (
  partial: Partial<ProvidersStore> | ((state: ProvidersStore) => Partial<ProvidersStore>),
) => void;
