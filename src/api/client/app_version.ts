import { create } from "zustand";

const header = "X-Misty-App-Version";
const version = import.meta.env.MISTY_APP_VERSION ?? "";

export const useAppUpdateRequired = create<{ minimum: string | null }>(() => ({ minimum: null }));

export function withAppVersion(input: RequestInfo | URL, init: RequestInit): RequestInit {
  if (!version) return init;
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set(header, version);
  return { ...init, headers };
}

export function noteAppVersionResponse(response: Response): void {
  if (response.status !== 426) return;
  let copy: Response;
  try {
    copy = response.clone();
  } catch {
    return;
  }
  void copy
    .json()
    .then((body: unknown) => {
      if (!body || typeof body !== "object") return;
      const { code, minimum } = body as { code?: unknown; minimum?: unknown };
      if (code !== "app_update_required") return;
      const value = typeof minimum === "string" && minimum ? minimum : "";
      if (useAppUpdateRequired.getState().minimum !== value)
        useAppUpdateRequired.setState({ minimum: value });
    })
    .catch(() => undefined);
}
