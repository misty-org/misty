import { appApiBase, appApiHeaders, saveAppAuthToken } from "../../apiClient";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface ForgotPasswordResponse {
  message?: string;
}

interface LoginResponse {
  id?: string;
  user_id: string;
  token?: string;
  name: string;
  email: string;
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const apiBase = await appApiBase();
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: await appApiHeaders({ "Content-Type": "application/json" }, path !== "/login" && path !== "/register"),
    body: JSON.stringify(body),
    credentials: "include",
  });

  const payload = await parsePayload(response, path);

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload.trim()
        : responseMessage(payload)
          ? responseMessage(payload)
          : "Something went wrong";
    throw new Error(message || "Something went wrong");
  }

  return payload as T;
}

async function getRequest<T>(path: string): Promise<T> {
  const apiBase = await appApiBase();
  const response = await fetch(`${apiBase}${path}`, {
    method: "GET",
    headers: await appApiHeaders(),
    credentials: "include",
  });

  const payload = await parsePayload(response, path);

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload.trim()
        : responseMessage(payload)
          ? responseMessage(payload)
          : "Something went wrong";
    throw new Error(message || "Something went wrong");
  }

  return payload as T;
}

export async function signInRequest(email: string, password: string): Promise<AuthUser> {
  const data = await request<LoginResponse>("/login", { email, password });
  const id = data.user_id ?? data.id;
  if (!id) {
    throw new Error("Sign-in response did not include a user id.");
  }
  await saveAppAuthToken(data.token);
  return {
    id,
    name: data.name,
    email: data.email,
  };
}

export async function registerRequest(name: string, email: string, password: string): Promise<AuthUser> {
  const data = await request<LoginResponse>("/register", { name, email, password });
  const id = data.user_id ?? data.id;
  if (!id) {
    throw new Error("Registration response did not include a user id.");
  }
  await saveAppAuthToken(data.token);
  return {
    id,
    name: data.name,
    email: data.email,
  };
}

export async function forgotPasswordRequest(email: string): Promise<string> {
  const data = await request<ForgotPasswordResponse>("/auth/forgot", { email });
  return data.message ?? "If the account exists, a password reset email will be sent shortly.";
}

export function validateResetTokenRequest() {
  return getRequest("/auth/reset/validate");
}

export function resetPasswordRequest(newPassword: string) {
  return request("/auth/reset", { new_password: newPassword });
}

async function parsePayload(response: Response, path: string): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return text;
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const firstJsonValue = firstJsonValueText(text);
    if (firstJsonValue) return JSON.parse(firstJsonValue);
    throw new Error(`Misty server returned malformed JSON for ${path}: ${textPreview(text)}${error instanceof Error ? ` (${error.message})` : ""}`);
  }
}

function textPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160) || "empty response";
}

function firstJsonValueText(value: string): string | null {
  const start = value.search(/[\[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

function responseMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}
