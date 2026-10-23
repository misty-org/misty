import { httpRequest } from "@/api/client/http";
import { readApiAuthToken, readApiSessionGeneration } from "@/api/client/session";
import { readDownloadBlob } from "@/api/spaces/signed-download";
import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";
import {
  assertStableSpaceAccount,
  resolveSpacesApiBase,
  spaceErrorMessage,
  SpaceRequestError,
} from "./api";

/** Fetches a file the server only serves to the signed-in account. */
export async function downloadProtectedFile(
  path: string,
  filename: string,
  init?: RequestInit,
): Promise<void> {
  const blob = await fetchProtectedBlob(path, init);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function fetchProtectedBlob(path: string, init?: RequestInit): Promise<Blob> {
  const accountGeneration = readApiSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  const base = await resolveSpacesApiBase();
  const token = await readApiAuthToken();
  assertStableSpaceAccount(accountGeneration);
  const headers = addRequestCorrelation(new Headers(init?.headers));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await httpRequest(`${base}${path}`, { credentials: "include", ...init, headers });
  } catch (error) {
    assertStableSpaceAccount(accountGeneration);
    throw error;
  }
  assertStableSpaceAccount(accountGeneration);
  if (!response.ok) {
    const text = await response.text();
    assertStableSpaceAccount(accountGeneration);
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { code?: string }).code;
    } catch {
      /* plain text */
    }
    throw new SpaceRequestError(spaceErrorMessage(code, text), response.status, code);
  }
  const blob = await readDownloadBlob(response);
  assertStableSpaceAccount(accountGeneration);
  return blob;
}
