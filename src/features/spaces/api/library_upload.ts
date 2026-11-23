import type { LibraryUploadResult } from "./dto/entities";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { assertUploadLimit } from "./upload_limits";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";

import { assertStableSpaceAccount, spaceRequest, SpaceRequestError } from "./api";
export async function uploadLibraryPath(
  spaceId: string,
  path: string,
  purpose: "attachment",
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readApiSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  options?.onStage?.("reading");
  const response = await fetch(safeTauriAssetUrl(path), { signal: options?.signal });
  assertStableSpaceAccount(accountGeneration);
  if (!response.ok) throw new Error(`Misty could not read ${fileNameFromPath(path)}.`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize) assertUploadLimit(purpose, declaredSize);
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

export async function uploadLibraryBlob(
  spaceId: string,
  blob: Blob,
  filename: string,
  purpose: "attachment" = "attachment",
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readApiSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  if (blob.size > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  return uploadLibraryFile(spaceId, file, purpose, accountGeneration, options);
}

export function fileNameFromPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "file"
  );
}

async function uploadLibraryFile(
  spaceId: string,
  file: File,
  purpose: "attachment",
  accountGeneration: number,
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  assertStableSpaceAccount(accountGeneration);
  if (file.size === 0) throw new Error(`${file.name || "That file"} is empty.`);
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
    }),
  });
  const finalizeHeaders = initiated.finalize?.headers ?? {
    "X-Misty-Library-Upload-Token":
      initiated.transfer.headers["X-Misty-Library-Upload-Token"] ??
      initiated.transfer.headers["x-misty-library-upload-token"],
  };
  const uploadPath = `/spaces/${encodeURIComponent(spaceId)}/library/uploads/${encodeURIComponent(initiated.upload.id)}`;
  try {
    options?.onStage?.("uploading");
    await transferLibraryObject(initiated.transfer, file, accountGeneration, options);
    options?.onStage?.("finalizing");
    return await spaceRequest<LibraryUploadResult>(`${uploadPath}/finalize`, {
      method: "POST",
      headers: finalizeHeaders,
    });
  } catch (error) {
    if (accountGeneration === readApiSessionGeneration())
      void spaceRequest(`${uploadPath}/abort`, { method: "POST", headers: finalizeHeaders }).catch(
        () => undefined,
      );
    throw error;
  }
}

export async function transferLibraryObject(
  transfer: { url: string; method?: string; headers: Record<string, string> },
  file: File,
  accountGeneration: number,
  options?: LibraryUploadOptions,
): Promise<void> {
  assertStableSpaceAccount(accountGeneration);
  if (!/^https:\/\//i.test(transfer.url))
    throw new Error("The Space server didn't give a direct upload address. Try again.");

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open(transfer.method || "PUT", transfer.url, true);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(transfer.headers ?? {})) {
      if (!value || /^(host|content-length|connection|origin)$/i.test(name)) continue;
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (isApiSessionTransitioning() || accountGeneration !== readApiSessionGeneration()) {
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
        reject(new SpaceRequestError(directTransferErrorMessage(request.status), request.status));
      }
    };
    request.onerror = () => {
      options?.signal?.removeEventListener("abort", abort);
      reject(new Error(directTransferErrorMessage(0)));
    };
    request.onabort = () => reject(new DOMException("The upload was canceled.", "AbortError"));
    if (options?.signal?.aborted) return abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
  assertStableSpaceAccount(accountGeneration);
}

function directTransferErrorMessage(status: number): string {
  if (status === 403 || status === 0) {
    return "The direct R2 upload was blocked by the bucket CORS/preflight policy.";
  }
  return "The direct R2 upload failed.";
}

export const maxWebviewUploadBytes = 128 * 1024 * 1024;

function webviewUploadSizeError(): Error {
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
