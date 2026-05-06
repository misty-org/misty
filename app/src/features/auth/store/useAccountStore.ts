import { accountApi, AccountApiError, configureAccountApi } from "@/api/account/api";
import type {
  AccountAuthUser,
  AccountHandoffPath,
  AccountMeResponse,
  LoginResponse,
} from "@/api/account/types";
import { fetchCurrentInstanceDescriptor, resolveDeploymentTarget } from "@/api/deployment/api";
import { configureTelemetryPreferencesSync } from "@/telemetry/lifecycle";
import { analytics } from "@/telemetry/client";
import { saveAccountAuthToken } from "./useAuthTokenStore";

export type {
  AccountAuthUser,
  AccountHandoffPath,
  AccountMeResponse,
  LoginResponse,
} from "@/api/account/types";
export { isAccountUnauthorizedError } from "@/api/account/api";

configureAccountApi({ readAnalyticsEnabled: () => analytics.isAnalyticsEnabled() });

function authenticatedUser(data: LoginResponse, operation: string): AccountAuthUser {
  const id = data.user_id ?? data.id;
  if (!id) throw new AccountApiError(`${operation} response did not include a user id.`);
  return { id, name: data.name, username: data.username, email: data.email };
}

async function persistLogin(data: LoginResponse, operation: string): Promise<AccountAuthUser> {
  const user = authenticatedUser(data, operation);
  if (data.token) await saveAccountAuthToken(data.token, user);
  return user;
}

export async function accountSignIn(email: string, password: string): Promise<AccountAuthUser> {
  return persistLogin(await accountApi.signIn(email, password), "Sign-in");
}

export async function accountRegister(
  name: string,
  username: string,
  email: string,
  password: string,
  selfHostToken?: string,
): Promise<AccountAuthUser> {
  let path: "/register" | "/self-host/bootstrap" | "/self-host/enroll" = "/register";
  const body: Record<string, string> = { name, username, email, password };
  if ((await resolveDeploymentTarget()).mode === "self_hosted") {
    const descriptor = await fetchCurrentInstanceDescriptor();
    if (!selfHostToken?.trim()) throw new Error("An enrollment token is required.");
    if (descriptor.bootstrap_required) {
      path = "/self-host/bootstrap";
      body.bootstrap_token = selfHostToken.trim();
    } else {
      path = "/self-host/enroll";
      body.invitation = selfHostToken.trim();
    }
  }
  return persistLogin(await accountApi.register(path, body), "Registration");
}

export function accountFetchMe(): Promise<AccountMeResponse> {
  return accountApi.me();
}

export function accountCreateHandoffUrl(path?: AccountHandoffPath): Promise<{ url: string }> {
  return accountApi.handoff(path);
}

export function accountFetchAvatar(): Promise<Blob> {
  return accountApi.avatar();
}

export function accountUpdateTelemetryPreferences(
  analyticsEnabled: boolean,
  errorReportingEnabled: boolean,
): Promise<void> {
  return accountApi.updateTelemetry(analyticsEnabled, errorReportingEnabled);
}

export function resolveAccountApiBase(): Promise<string> {
  return accountApi.resolveBase();
}

configureTelemetryPreferencesSync(accountUpdateTelemetryPreferences);
