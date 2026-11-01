import { nativeAccountFetch } from "@/api/client/native-account-fetch";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Whether a Misty server answers at an API base, before the setup wizard switches to it. The
 * request goes through the native layer like every account request, so no website origin rules
 * apply; it carries no account.
 */
export async function probeServer(apiBase: string, signal?: AbortSignal): Promise<boolean> {
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
