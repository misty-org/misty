import { nativeAccountFetch } from "@/api/client/native-account-fetch";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { mistyCloudServer } from "./serverChoice";

/**
 * A release build refuses a domain that resolves to a private address, such as a hosts-file entry
 * for this computer. Misty Pro is exempt: some VPN and proxy tools answer every name with a private
 * address, and that must not lock anyone out of Misty's own server.
 */
async function refusePrivateServer(apiBase: string): Promise<void> {
  if (import.meta.env.DEV || !hasTauriInternals() || apiBase === mistyCloudServer()) return;
  const host = new URL(apiBase).hostname;
  if (!(await invoke<boolean>("server_host_resolves_public", { host })))
    throw new Error("That domain points to a private address. Misty needs a public server.");
}

/**
 * Whether a Misty server answers at an API base, before the setup wizard switches to it. The
 * request goes through the native layer like every account request, so no website origin rules
 * apply; it carries no account. Throws when the address is one Misty refuses.
 */
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
