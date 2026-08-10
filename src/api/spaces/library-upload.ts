import type { LibraryUploadResult, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { readDownloadBlob } from "@/api/spaces/signed-download";
import { assertUploadLimit } from "@/api/spaces/upload-limits";
import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import {
  isSpaceAccountSessionTransitioning,
  readSpaceAccountGeneration,
  readSpaceAccountToken,
} from "./session";

import {
  assertStableSpaceAccount,
  resolveSpacesApiBase,
  spaceErrorMessage,
  spaceRequest,
  SpaceRequestError,
} from "./api";
export async function uploadLibraryPath(
  spaceId: string,
  path: string,
  purpose: "library" | "attachment",
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readSpaceAccountGeneration();
  assertStableSpaceAccount(accountGeneration);
  options?.onStage?.("reading");
  const response = await fetch(safeTauriAssetUrl(path), { signal: options?.signal });
  assertStableSpaceAccount(accountGeneration);
  if (!response.ok) throw new Error(`Misty could not read ${fileNameFromPath(path)}.`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const blob = await response.blob();
  assertStableSpaceAccount(accountGeneration);
  if (blob.size > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const file = new File([blob], fileNameFromPath(path), {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  return uploadLibraryFile(spaceId, file, purpose, accountGeneration, options);
}

/** Uploads a client-produced Blob as a NEW library item (used for "Save as a copy"). */
export async function uploadLibraryBlob(
  spaceId: string,
  blob: Blob,
  filename: string,
  purpose: "library" | "attachment" = "library",
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readSpaceAccountGeneration();
  assertStableSpaceAccount(accountGeneration);
  if (blob.size > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  return uploadLibraryFile(spaceId, file, purpose, accountGeneration, options);
}

/**
 * Replaces an existing library item's content in place with a client-rendered
 * Blob, keeping the same item id (used for "Save"). Item identity is owned by
 * the server; if it doesn't honor `replace_item_id` and mints a new id instead,
 * we trash the stray upload and throw so the caller can fall back to a copy.
 */
export async function replaceLibraryItemContent(
  spaceId: string,
  item: SpaceLibraryItem,
  blob: Blob,
  filename: string,
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readSpaceAccountGeneration();
  assertStableSpaceAccount(accountGeneration);
  if (blob.size > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  const result = await uploadLibraryFile(spaceId, file, "library", accountGeneration, options, {
    itemId: item.id,
    itemVersion: item.version,
  });
  if (result.item && result.item.id !== item.id) {
    try {
      await spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(result.item.id)}/trash`,
        { method: "POST" },
      );
    } catch {
      // Best-effort cleanup of the stray item; ignore failures.
    }
    throw new Error(
      'Saving over the original isn’t supported by this server yet — use "Save as a copy" instead.',
    );
  }
  return result;
}

export function fileNameFromPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "file"
  );
}

export async function uploadLibraryFile(
  spaceId: string,
  file: File,
  purpose: "library" | "attachment",
  accountGeneration: number,
  options?: LibraryUploadOptions,
  replace?: { itemId: string; itemVersion: number },
): Promise<LibraryUploadResult> {
  assertStableSpaceAccount(accountGeneration);
  assertUploadLimit(purpose, file.size);
  options?.onStage?.("hashing");
  const bytes = await file.arrayBuffer();
  assertStableSpaceAccount(accountGeneration);
  const sha256 = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  assertStableSpaceAccount(accountGeneration);
  const initiated = await spaceRequest<{
    upload: { id: string };
    transfer: { url: string; method?: string; headers: Record<string, string> };
    finalize?: { headers?: Record<string, string> };
  }>(`/spaces/${encodeURIComponent(spaceId)}/library/uploads`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      byte_size: file.size,
      sha256,
      purpose,
      ...(options?.conversationId ? { conversation_id: options.conversationId } : {}),
      // In-place replace: the server should reuse `replace_item_id` instead of
      // minting a new item. Older servers ignore these and mint a new id, which
      // replaceLibraryItemContent() detects and cleans up.
      ...(replace
        ? { replace_item_id: replace.itemId, replace_item_version: replace.itemVersion }
        : {}),
    }),
  });
  options?.onStage?.("uploading");
  await transferLibraryObject(initiated.transfer, file, accountGeneration, options);
  options?.onStage?.("finalizing");
  const finalizeHeaders = initiated.finalize?.headers ?? {
    "X-Misty-Library-Upload-Token":
      initiated.transfer.headers["X-Misty-Library-Upload-Token"] ??
      initiated.transfer.headers["x-misty-library-upload-token"],
  };
  return spaceRequest<LibraryUploadResult>(
    `/spaces/${encodeURIComponent(spaceId)}/library/uploads/${encodeURIComponent(initiated.upload.id)}/finalize`,
    {
      method: "POST",
      headers: finalizeHeaders,
    },
  );
}

export async function transferLibraryObject(
  transfer: { url: string; method?: string; headers: Record<string, string> },
  file: File,
  accountGeneration: number,
  options?: LibraryUploadOptions,
): Promise<void> {
  assertStableSpaceAccount(accountGeneration);
  const direct = /^https?:\/\//i.test(transfer.url);
  const [base, token] = direct
    ? ["", ""]
    : await Promise.all([resolveSpacesApiBase(), readSpaceAccountToken()]);
  assertStableSpaceAccount(accountGeneration);
  const url = direct ? transfer.url : `${base}${transfer.url}`;
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open(transfer.method || "PUT", url, true);
    request.withCredentials = !direct;
    for (const [name, value] of Object.entries(transfer.headers ?? {})) {
      if (!value || /^(host|content-length|connection|origin)$/i.test(name)) continue;
      request.setRequestHeader(name, value);
    }
    if (!direct && token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (
        isSpaceAccountSessionTransitioning() ||
        accountGeneration !== readSpaceAccountGeneration()
      ) {
        request.abort();
        return;
      }
      if (event.lengthComputable && event.total > 0)
        options?.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => {
      options?.signal?.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) {
        options?.onProgress?.(1);
        resolve();
      } else {
        reject(
          new SpaceRequestError(directTransferErrorMessage(direct, request.status), request.status),
        );
      }
    };
    request.onerror = () => {
      options?.signal?.removeEventListener("abort", abort);
      reject(new Error(directTransferErrorMessage(direct, 0)));
    };
    request.onabort = () => reject(new DOMException("The upload was canceled.", "AbortError"));
    if (options?.signal?.aborted) return abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
  assertStableSpaceAccount(accountGeneration);
}

export function directTransferErrorMessage(direct: boolean, status: number): string {
  if (!direct) return "The cloud upload failed.";
  if (status === 403 || status === 0) {
    return "The direct R2 upload was blocked by the bucket CORS/preflight policy.";
  }
  return "The direct R2 upload failed.";
}

export function libraryReauthenticationHeaders(token: string): Record<string, string> {
  return token ? { "X-Misty-Library-Reauthentication": token } : {};
}

export function libraryPreviewPath(
  spaceId: string,
  itemId: string,
  original: boolean,
  cacheVersion?: string | number,
): string {
  const query = new URLSearchParams();
  if (original) query.set("version", "original");
  if (cacheVersion !== undefined && String(cacheVersion))
    query.set("cache_version", String(cacheVersion));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/preview${suffix}`;
}

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
  const accountGeneration = readSpaceAccountGeneration();
  assertStableSpaceAccount(accountGeneration);
  const [base, token] = await Promise.all([resolveSpacesApiBase(), readSpaceAccountToken()]);
  assertStableSpaceAccount(accountGeneration);
  const headers = addRequestCorrelation(new Headers(init?.headers));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { credentials: "include", ...init, headers });
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

export const maxWebviewUploadBytes = 128 * 1024 * 1024;

export function webviewUploadSizeError(): Error {
  return new Error(
    "This beta can safely copy files up to 128 MB. Larger files need Misty’s streaming uploader.",
  );
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export interface LibraryUploadOptions {
  signal?: AbortSignal;
  conversationId?: string;
  onProgress?: (progress: number) => void;
  onStage?: (stage: "reading" | "hashing" | "uploading" | "finalizing") => void;
}
