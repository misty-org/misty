const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  created_at: string;
  tier: "free" | "pro" | "max";
  status: "active" | "cancelled" | "expired";
  expires_at: string | null;
  license_device: string;
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(text.trim() || "Request failed"), { status: res.status });
  }
  return res;
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await apiFetch("/me");
  return res.json();
}

export async function updateProfile(name: string): Promise<void> {
  await apiFetch("/me/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function updateDevice(device: string): Promise<void> {
  await apiFetch("/me/device", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device }),
  });
}

export async function logoutRequest(): Promise<void> {
  await fetch(`${apiBase}/logout`, { method: "POST", credentials: "include" });
}
