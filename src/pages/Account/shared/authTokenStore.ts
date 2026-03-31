import { remove, retrieve, store } from "@impierce/tauri-plugin-keystore";
import { hasTauriInternals } from "../../../shared/tauri";
import { isNativeMobileBuild } from "../../../platform/buildTarget";

const desktopTokenService = "com.impierce.identity-wallet";
const desktopTokenUser = "tester";
const tokenStoredMarkerKey = "misty:account-auth-token:keychain-present";

let cachedToken: string | null | undefined;

export async function saveAccountAuthToken(token: string): Promise<void> {
  cachedToken = token;
  if (!token) return;
  if (!hasTauriInternals()) return;

  try {
    await store(token);
    writeTokenStoredMarker(true);
  } catch (error) {
    recordTokenDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not store Misty auth token in the device keystore.",
      detail: errorDetail(error),
    });
  }
}

export async function readAccountAuthToken(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  if (cachedToken !== undefined) return cachedToken;
  if (!readTokenStoredMarker()) {
    cachedToken = null;
    return cachedToken;
  }

  try {
    cachedToken = await retrieve(desktopTokenService, desktopTokenUser);
  } catch (error) {
    cachedToken = null;
    writeTokenStoredMarker(false);
    recordTokenDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not read Misty auth token from the device keystore.",
      detail: errorDetail(error),
    });
  }
  return cachedToken;
}

export async function clearAccountAuthToken(): Promise<void> {
  cachedToken = null;
  const shouldClearKeystore = readTokenStoredMarker();
  writeTokenStoredMarker(false);
  if (!hasTauriInternals()) return;
  if (!shouldClearKeystore) return;
  try {
    await remove(desktopTokenService, desktopTokenUser);
  } catch (error) {
    recordTokenDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not clear Misty auth token from the device keystore.",
      detail: errorDetail(error),
    });
  }
}

function readTokenStoredMarker(): boolean {
  try {
    return localStorage.getItem(tokenStoredMarkerKey) === "1";
  } catch {
    return false;
  }
}

function writeTokenStoredMarker(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(tokenStoredMarkerKey, "1");
    } else {
      localStorage.removeItem(tokenStoredMarkerKey);
    }
  } catch {
    // The marker is non-secret. If storage is unavailable, keep the in-memory cache only.
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

function recordTokenDebugEvent(event: {
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: string;
}): void {
  if (!tokenDebugEnabled()) return;
  void import("../../../shared/debug/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}

function tokenDebugEnabled(): boolean {
  return !isNativeMobileBuild &&
    (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
}
