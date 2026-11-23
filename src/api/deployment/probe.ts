import { nativeAccountFetch } from "@/api/client/native_account_fetch";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { mistyCloudServer } from "./server_choice";

async function refusePrivateServer(apiBase: string): Promise<void> {
  if (import.meta.env.DEV || !hasTauriInternals() || apiBase === mistyCloudServer()) return;
  const host = new URL(apiBase).hostname;
  if (!(await invoke<boolean>("server_host_resolves_public", { host })))
    throw new Error("That domain points to a private address. Misty needs a public server.");
}

export async function probeServer(apiBase: string, signal?: AbortSignal): Promise<boolean> {
  await refusePrivateServer(apiBase);
  const url = `${apiBase}/health`;
  const timeout = AbortSignal.timeout(10_000);
  const init: RequestInit = {
    method: "GET",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  };
  try {
    const response = hasTauriInternals()
      ? await nativeAccountFetch(url, init)
      : await fetch(url, init);
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}
