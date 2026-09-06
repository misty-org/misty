import { httpRequest } from "@/api/client/http";
import {
  isMistyJournalAssetMethod,
  mistyJournalAssetContracts,
  parseMethodResult,
  MISTY_JOURNAL_ASSET_CHUNK_BYTES,
  MISTY_JOURNAL_ASSET_MAX_BYTES,
  type MistyJournalAssetParams,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";
import type { createServerRpc } from "./server";

type Upload = MistyJournalAssetParams<"journal.assets.begin">;
type Transfer = {
  handle: string;
  resource: "note" | "drawing";
  resourceId: string;
  mode: "upload" | "download";
  controller: AbortController;
  bytes?: Uint8Array<ArrayBuffer>;
  input?: Upload;
  written: number;
  busy: boolean;
  timer: ReturnType<typeof setTimeout>;
};

/** Owns credentials and verified bytes; app-facing handles are scoped to one mounted view. */
export function createJournalAssetsRpc(
  scope: AppRpcScope,
  server: Pick<ReturnType<typeof createServerRpc>, "request">,
  fetcher: typeof fetch = httpRequest,
) {
  const transfers = new Map<string, Transfer>();
  let closed = false;
  const fail = (code: string, message: string): never => {
    throw new AppRpcError(code, message);
  };
  const assert = (resource: Transfer["resource"], write: boolean) => {
    scope.assert(`${resource === "note" ? "notes" : "drawings"}.${write ? "write" : "read"}`);
    if (closed) fail("app_closed", "The Journal asset runtime has closed.");
    if (!scope.identity.spaceId)
      fail("space_required", "Open a Space before using Journal assets.");
  };
  const dispose = (transfer: Transfer) => {
    transfers.delete(transfer.handle);
    clearTimeout(transfer.timer);
    transfer.controller.abort();
    transfer.bytes = undefined;
  };
  const active = (transfer: Transfer) => {
    assert(transfer.resource, transfer.mode === "upload");
    if (transfer.controller.signal.aborted || transfers.get(transfer.handle) !== transfer)
      fail("transfer_closed", "The Journal asset transfer has closed.");
  };
  const allocate = (resource: Transfer["resource"], resourceId: string, mode: Transfer["mode"]) => {
    assert(resource, mode === "upload");
    if (transfers.size >= 2)
      fail("transfer_limit", "Finish an existing Journal asset transfer first.");
    const handle = crypto.randomUUID();
    const transfer: Transfer = {
      handle,
      resource,
      resourceId,
      mode,
      controller: new AbortController(),
      written: 0,
      busy: false,
      timer: setTimeout(() => dispose(transfer), 5 * 60_000),
    };
    transfers.set(handle, transfer);
    return transfer;
  };
  const owned = (handle: string, mode?: Transfer["mode"]) => {
    scope.assert();
    const transfer = transfers.get(handle);
    if (!transfer || (mode && transfer.mode !== mode))
      return fail("resource_denied", "This Journal asset handle is unavailable.");
    active(transfer);
    return transfer;
  };
  const close = () => {
    closed = true;
    [...transfers.values()].forEach(dispose);
  };
  scope.signal.addEventListener("abort", close, { once: true });
  if (scope.signal.aborted) close();

  return {
    close,
    async request(message: { method: string; params?: unknown }): Promise<unknown> {
      scope.assert();
      if (!isMistyJournalAssetMethod(message.method))
        return fail("unsupported_method", "Unknown Journal asset method.");
      const params = mistyJournalAssetContracts[message.method].params.parse(message.params);
      if (message.method === "journal.assets.begin") {
        const input = params as Upload;
        const transfer = allocate(input.resource, input.resourceId, "upload");
        transfer.input = input;
        transfer.bytes = new Uint8Array(input.bytes);
        return { handle: transfer.handle };
      }
      if (message.method === "journal.assets.open") {
        const input = params as MistyJournalAssetParams<"journal.assets.open">;
        const transfer = allocate(input.resource, input.resourceId, "download");
        transfer.busy = true;
        try {
          const method =
            input.resource === "note" ? "notes.assets.download" : "drawings.assets.download";
          const path =
            input.resource === "note"
              ? { noteID: input.resourceId, assetID: input.assetId }
              : { drawingID: input.resourceId, assetID: input.assetId };
          const descriptor = parseMethodResult(
            method,
            await server.request(
              { method, params: { path } },
              { signal: transfer.controller.signal },
            ),
          );
          active(transfer);
          validExpiry(descriptor.expires_at);
          const response = await fetcher(descriptor.url, {
            signal: transfer.controller.signal,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
          });
          active(transfer);
          if (!response.ok)
            fail(
              "asset_download_failed",
              `The Journal asset could not be downloaded (${response.status}).`,
            );
          const bytes = await boundedRead(
            response,
            descriptor.byte_size,
            transfer.controller.signal,
          );
          active(transfer);
          if ((await digest(bytes)) !== descriptor.sha256)
            fail("asset_checksum", "The Journal asset checksum did not match.");
          active(transfer);
          transfer.bytes = bytes;
          transfer.busy = false;
          return {
            handle: transfer.handle,
            filename: descriptor.filename,
            mimeType: descriptor.mime_type,
            bytes: bytes.length,
            sha256: descriptor.sha256,
          };
        } catch (error) {
          dispose(transfer);
          throw publicError(error);
        }
      }
      const { handle } = params as { handle: string };
      if (message.method === "journal.assets.close") {
        const transfer = transfers.get(handle);
        if (transfer) dispose(transfer);
        return;
      }
      if (message.method === "journal.assets.write") {
        const input = params as MistyJournalAssetParams<"journal.assets.write">;
        const transfer = owned(handle, "upload");
        if (transfer.busy) fail("transfer_busy", "The Journal asset is being committed.");
        const bytes = Uint8Array.from(atob(input.data), (char) => char.charCodeAt(0));
        if (
          !bytes.length ||
          bytes.length > MISTY_JOURNAL_ASSET_CHUNK_BYTES ||
          input.offset !== transfer.written ||
          input.offset + bytes.length > transfer.bytes!.length
        )
          fail("invalid_chunk", "Invalid Journal asset chunk.");
        transfer.bytes!.set(bytes, input.offset);
        transfer.written += bytes.length;
        return;
      }
      if (message.method === "journal.assets.read") {
        const input = params as MistyJournalAssetParams<"journal.assets.read">;
        const transfer = owned(handle, "download");
        if (transfer.busy || !transfer.bytes || input.offset + input.length > transfer.bytes.length)
          fail("invalid_chunk", "Invalid Journal asset chunk.");
        return {
          data: encode(transfer.bytes!.subarray(input.offset, input.offset + input.length)),
        };
      }
      const transfer = owned(handle, "upload");
      if (transfer.busy || transfer.written !== transfer.input!.bytes)
        fail(
          "transfer_incomplete",
          "The Journal asset upload is incomplete or already committing.",
        );
      transfer.busy = true;
      try {
        const input = transfer.input!,
          bytes = transfer.bytes!;
        const sha256 = await digest(bytes);
        active(transfer);
        const reserveMethod =
          input.resource === "note" ? "notes.assets.reserve" : "drawings.assets.reserve";
        const path =
          input.resource === "note"
            ? { noteID: input.resourceId }
            : { drawingID: input.resourceId };
        const body = {
          filename: input.filename,
          mime_type: input.mimeType,
          byte_size: input.bytes,
          sha256,
          ...(input.resource === "drawing" ? { file_id: input.externalFileId } : {}),
        };
        const reservation = parseMethodResult(
          reserveMethod,
          await server.request(
            { method: reserveMethod, params: { path, body } },
            { signal: transfer.controller.signal },
          ),
        );
        active(transfer);
        validExpiry(reservation.transfer.expires_at);
        const finalHeaders = new Headers(reservation.finalize.headers);
        if ([...finalHeaders.keys()].some((key) => key !== "x-misty-library-upload-token"))
          fail("invalid_upload_credential", "Misty returned unsupported upload credentials.");
        const token = finalHeaders.get("x-misty-library-upload-token");
        if (!token || !/^[\x21-\x2b\x2d-\x7e]{1,1024}$/.test(token))
          fail("invalid_upload_credential", "Misty did not return a valid upload credential.");
        const headers = new Headers(reservation.transfer.headers);
        for (const key of headers.keys()) {
          if (!/^(content-type|content-md5|x-amz-[a-z0-9-]+)$/.test(key))
            fail("invalid_transfer_headers", "Misty returned unsupported asset transfer headers.");
        }
        const response = await fetcher(reservation.transfer.url, {
          method: "PUT",
          headers,
          body: bytes.buffer,
          signal: transfer.controller.signal,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });
        active(transfer);
        if (!response.ok)
          fail("asset_upload_failed", `The Journal asset upload failed (${response.status}).`);
        await response.body?.cancel();
        active(transfer);
        const method =
          input.resource === "note" ? "notes.assets.finalize" : "drawings.assets.finalize";
        const result = parseMethodResult(
          method,
          await server.request(
            { method, params: { path: { ...path, uploadID: reservation.upload.id } } },
            { signal: transfer.controller.signal, journalUploadToken: token! },
          ),
        );
        active(transfer);
        const asset = "note_asset" in result ? result.note_asset : result.drawing_asset;
        if (
          asset.byte_size !== input.bytes ||
          asset.sha256 !== sha256 ||
          asset.mime_type !== input.mimeType ||
          (input.resource === "drawing" &&
            (!("excalidraw_file_id" in asset) || asset.excalidraw_file_id !== input.externalFileId))
        )
          fail(
            "asset_checksum",
            "The completed Journal asset did not match its uploaded metadata.",
          );
        return asset;
      } catch (error) {
        throw publicError(error);
      } finally {
        dispose(transfer);
      }
    },
  };
}

function validExpiry(value: string) {
  if (Date.parse(value) <= Date.now())
    throw new AppRpcError("transfer_expired", "The Journal asset transfer expired.");
}
function publicError(error: unknown): Error {
  // Native fetch errors can include a signed URL. Keep those out of component errors.
  return error instanceof AppRpcError
    ? error
    : new AppRpcError(
        "asset_transfer_failed",
        "The Journal asset transfer failed. Please try again.",
      );
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
async function boundedRead(
  response: Response,
  size: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (size < 1 || size > MISTY_JOURNAL_ASSET_MAX_BYTES || !response.body)
    throw new AppRpcError("invalid_asset_size", "Invalid Journal asset size.");
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== size) {
    await response.body.cancel();
    throw new AppRpcError("asset_size", "The Journal asset size did not match.");
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted)
        throw new AppRpcError("transfer_closed", "The Journal asset transfer closed.");
      if (done) break;
      if (offset + value.length > size)
        throw new AppRpcError("asset_size", "The Journal asset exceeds its declared size.");
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== size) throw new AppRpcError("asset_size", "The Journal asset is incomplete.");
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
