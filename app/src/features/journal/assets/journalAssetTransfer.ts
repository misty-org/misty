import { httpRequest } from "@/api/http";
import { spaceRequest } from "@/api/spaces/api";

export const MAX_JOURNAL_ASSET_BYTES = 15 * 1024 * 1024;

export type JournalAssetKind = "note" | "drawing";

export interface JournalAssetRecord {
  id: string;
  mime_type?: string;
  byte_size?: number;
  sha256?: string;
}

interface UploadReservation {
  upload: { id: string };
  transfer: {
    url: string;
    method?: string;
    headers: Record<string, string>;
  };
  finalize?: { headers?: Record<string, string> };
}

interface UploadResult {
  note_asset?: JournalAssetRecord;
  drawing_asset?: JournalAssetRecord & {
    excalidraw_file_id: string;
  };
}

export interface SignedJournalAssetDownload {
  url: string;
  expires_at: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
}

export async function uploadJournalAsset(input: {
  kind: JournalAssetKind;
  spaceId: string;
  resourceId: string;
  file: File;
  externalFileId?: string;
}): Promise<JournalAssetRecord> {
  if (input.file.size < 1 || input.file.size > MAX_JOURNAL_ASSET_BYTES) {
    throw new Error("Journal files must be 15 MB or smaller.");
  }
  const bytes = await input.file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const resource = input.kind === "note" ? "notes" : "drawings";
  const basePath = `/spaces/${encodeURIComponent(input.spaceId)}/${resource}/${encodeURIComponent(input.resourceId)}/assets`;
  const reservation = await spaceRequest<UploadReservation>(`${basePath}/uploads`, {
    method: "POST",
    body: JSON.stringify({
      ...(input.kind === "drawing" ? { file_id: input.externalFileId } : {}),
      filename: input.file.name || `${input.kind}-asset`,
      mime_type: input.file.type || "application/octet-stream",
      byte_size: input.file.size,
      sha256,
    }),
  });

  await withTransientRetry(() => putDirectlyToR2(reservation.transfer, input.file));
  const completed = await withTransientRetry(() =>
    spaceRequest<UploadResult>(
      `${basePath}/uploads/${encodeURIComponent(reservation.upload.id)}/finalize`,
      {
        method: "POST",
        headers: reservation.finalize?.headers ?? {},
      },
    ),
  );
  const asset = input.kind === "note" ? completed.note_asset : completed.drawing_asset;
  if (!asset?.id) throw new Error("Misty did not return the uploaded Journal asset.");
  return asset;
}

export function journalAssetDownloadPath(
  kind: JournalAssetKind,
  spaceId: string,
  resourceId: string,
  assetId: string,
): string {
  const resource = kind === "note" ? "notes" : "drawings";
  return `/spaces/${encodeURIComponent(spaceId)}/${resource}/${encodeURIComponent(resourceId)}/assets/${encodeURIComponent(assetId)}/download`;
}

const resolvedAssetCache = new Map<string, Promise<string>>();

export function resolveJournalAssetUrl(downloadPath: string): Promise<string> {
  const cached = resolvedAssetCache.get(downloadPath);
  if (cached) return cached;
  const pending = downloadAndVerifyJournalAsset(downloadPath).catch((error) => {
    resolvedAssetCache.delete(downloadPath);
    throw error;
  });
  resolvedAssetCache.set(downloadPath, pending);
  if (resolvedAssetCache.size > 128) {
    const oldest = resolvedAssetCache.keys().next().value;
    if (oldest) resolvedAssetCache.delete(oldest);
  }
  return pending;
}

export function clearJournalAssetCache(): void {
  resolvedAssetCache.clear();
}

async function putDirectlyToR2(transfer: UploadReservation["transfer"], file: File): Promise<void> {
  if (!/^https:\/\//i.test(transfer.url)) {
    throw new Error("Journal assets require a direct Cloudflare R2 upload.");
  }
  const response = await httpRequest(transfer.url, {
    method: transfer.method || "PUT",
    headers: transfer.headers,
    body: file,
    credentials: "omit",
  });
  if (!response.ok) {
    const error = new Error(
      `Cloudflare R2 rejected the Journal asset (${response.status}).`,
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: unknown })?.status;
      if (typeof status === "number" && status < 500) throw error;
      if (attempt < 2) {
        const delay = import.meta.env.MODE === "test" ? 0 : 250 * 2 ** attempt;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function downloadAndVerifyJournalAsset(downloadPath: string): Promise<string> {
  const descriptor = await spaceRequest<SignedJournalAssetDownload>(downloadPath);
  if (
    !/^https:\/\//i.test(descriptor.url) ||
    !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
    descriptor.byte_size < 1
  ) {
    throw new Error("Misty returned an invalid Journal asset descriptor.");
  }
  const response = await httpRequest(descriptor.url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Cloudflare R2 could not load the Journal asset (${response.status}).`);
  }
  const blob = await response.blob();
  if (blob.size !== descriptor.byte_size) {
    throw new Error("The Journal asset size did not match its verified metadata.");
  }
  const bytes = await blob.arrayBuffer();
  if ((await sha256Hex(bytes)) !== descriptor.sha256) {
    throw new Error("The Journal asset checksum did not match its verified metadata.");
  }
  return dataURLFromBytes(bytes, descriptor.mime_type || blob.type);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function dataURLFromBytes(bytes: ArrayBuffer, mimeType: string): string {
  const chunkSize = 0x8000;
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType || "application/octet-stream"};base64,${btoa(binary)}`;
}
