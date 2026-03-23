import { hubApiBase, hubApiHeaders, saveHubAuthToken } from "../../apiClient";

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
  const response = await fetch(`${hubApiBase()}${path}`, {
    method: "POST",
    headers: hubApiHeaders({ "Content-Type": "application/json" }, path !== "/login" && path !== "/register"),
    body: JSON.stringify(body),
    credentials: "include",
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  const isJSON = contentType.includes("application/json");
  const payload = isJSON ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload.trim()
        : typeof payload?.message === "string"
          ? payload.message
          : "Something went wrong";
    throw new Error(message || "Something went wrong");
  }

  return payload as T;
}

async function getRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${hubApiBase()}${path}`, {
    method: "GET",
    headers: hubApiHeaders(),
    credentials: "include",
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  const isJSON = contentType.includes("application/json");
  const payload = isJSON ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload.trim()
        : typeof payload?.message === "string"
          ? payload.message
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
  saveHubAuthToken(data.token);
  return {
    id,
    name: data.name,
    email: data.email,
  };
}

export function registerRequest(name: string, email: string, password: string) {
  return request("/register", { name, email, password });
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
