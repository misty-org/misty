import { remove, retrieve, store } from "@impierce/tauri-plugin-keystore";
import { recordClientDebugEvent } from "../../../shared/debug/clientDebug";

const tokenService = "com.misty.auth";
const tokenUser = "misty-session";

let cachedToken: string | null | undefined;

export async function saveAccountAuthToken(token: string): Promise<void> {
  cachedToken = token;
  if (!token) return;

  try {
    await store(token);
  } catch (error) {
    recordClientDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not store Misty auth token in the device keystore.",
      detail: errorDetail(error),
    });
  }
}

export async function readAccountAuthToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;

  try {
    cachedToken = await retrieve(tokenService, tokenUser);
  } catch (error) {
    cachedToken = null;
    recordClientDebugEvent({
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
  try {
    await remove(tokenService, tokenUser);
  } catch (error) {
    recordClientDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not clear Misty auth token from the device keystore.",
      detail: errorDetail(error),
    });
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
