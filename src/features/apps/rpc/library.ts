import { clipboardWriteFileBytes } from "@/native";
import { isMistyLibraryMethod, mistyLibraryContracts } from "@misty/sdk";
import { createSpaceLibraryItemsApi, type LibraryTransfers } from "@/api/spaces/library-items-core";
import { createSpaceLibraryCollectionsApi } from "@/api/spaces/library-collections";
import { createSpaceLibraryEditsApi } from "@/api/spaces/library-edits";
import { readDownloadBlob } from "@/api/spaces/signed-download";
import type { SpaceRequest } from "@/api/spaces/types";
import { AppRpcError, type AppRpcScope } from "./session";

export function createLibraryRpc(
  scope: AppRpcScope,
  options: { serverBase: string; token(): string },
) {
  const root = new URL(
    options.serverBase.endsWith("/") ? options.serverBase : options.serverBase + "/",
  );
  const prefix = `/spaces/${encodeURIComponent(scope.identity.spaceId ?? "")}/`;
  const requestResponse = async (path: string, init: RequestInit = {}) => {
    scope.assert();
    if (!scope.identity.spaceId || !(path.startsWith(prefix) || path === "/billing/usage"))
      throw new AppRpcError("space_mismatch", "This Library belongs to another Space.");
    const url = new URL(path.replace(/^\//, ""), root);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${options.token()}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(url, {
      ...init,
      headers,
      signal: scope.signal,
      credentials: "omit",
    });
    scope.assert();
    if (!response.ok) {
      const raw = await response.text();
      let message = raw;
      try {
        message = JSON.parse(raw).message ?? JSON.parse(raw).code ?? raw;
      } catch {}
      let code = "library_request_failed";
      try {
        code = JSON.parse(raw).code ?? code;
      } catch {}
      throw new AppRpcError(code, message.slice(0, 2000) || "Library request failed.");
    }
    return response;
  };
  const request: SpaceRequest = async (path, init) => {
    const response = await requestResponse(path, init);
    if (response.status === 204) return undefined as never;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  };
  const fetchProtectedBlob: LibraryTransfers["fetchProtectedBlob"] = async (path, init) => {
    const blob = await readDownloadBlob(await requestResponse(path, init));
    scope.assert();
    if (blob.size > 128 * 1024 * 1024) throw new Error("This Library transfer exceeds 128 MB.");
    return blob;
  };
  const unavailable = async () => {
    throw new Error("Use the Library upload operation for file content.");
  };
  const api = {
    ...createSpaceLibraryItemsApi(request, {
      fetchProtectedBlob,
      downloadProtectedFile: unavailable,
      uploadLibraryPath: unavailable,
      uploadLibraryBlob: unavailable,
      replaceLibraryItemContent: unavailable,
    }),
    ...createSpaceLibraryCollectionsApi(request),
    ...createSpaceLibraryEditsApi(request),
  };
  return {
    async request(message: { method: string; params?: unknown }) {
      if (!isMistyLibraryMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown Library operation.");
      const method = message.method;
      if (method === "library.copyFiles") {
        scope.assert("clipboard.write");
        const input = mistyLibraryContracts[method].params.parse(message.params);
        if (
          !(await clipboardWriteFileBytes(
            input.files.map((file) => ({
              name: file.name,
              bytes: Array.from(new Uint8Array(file.bytes)),
            })),
          ))
        )
          throw new Error("The files could not be copied.");
        scope.assert();
        return;
      }
      if (method === "library.upload") {
        scope.assert("library.write");
        const input = mistyLibraryContracts[method].params.parse(message.params);
        const sha256 = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", input.bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        scope.assert();
        const reservation = await request<{
          upload: { id: string };
          transfer: { url: string; method?: string; headers: Record<string, string> };
          finalize?: { headers?: Record<string, string> };
        }>(prefix + "library/uploads", {
          method: "POST",
          body: JSON.stringify({
            filename: input.name,
            mime_type: input.mimeType || "application/octet-stream",
            byte_size: input.bytes.byteLength,
            sha256,
            purpose: input.purpose,
            ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
            ...(input.replace
              ? {
                  replace_item_id: input.replace.itemId,
                  replace_item_version: input.replace.itemVersion,
                }
              : {}),
          }),
        });
        const target = new URL(
          /^https?:/.test(reservation.transfer.url)
            ? reservation.transfer.url
            : reservation.transfer.url.replace(/^\//, ""),
          root,
        );
        if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
          throw new Error("The upload destination is invalid.");
        const headers = new Headers(reservation.transfer.headers);
        if (target.origin === root.origin)
          headers.set("Authorization", `Bearer ${options.token()}`);
        const response = await fetch(target, {
          method: reservation.transfer.method || "PUT",
          headers,
          body: input.bytes,
          credentials: "omit",
          signal: scope.signal,
        });
        scope.assert();
        if (!response.ok) throw new Error("The Library upload failed.");
        const result = await request(
          prefix + `library/uploads/${encodeURIComponent(reservation.upload.id)}/finalize`,
          {
            method: "POST",
            headers: reservation.finalize?.headers ?? {
              "X-Misty-Library-Upload-Token":
                reservation.transfer.headers["X-Misty-Library-Upload-Token"] ??
                reservation.transfer.headers["x-misty-library-upload-token"] ??
                "",
            },
          },
        );
        const uploaded = mistyLibraryContracts[method].result.parse(result);
        if (
          input.replace &&
          uploaded &&
          typeof uploaded === "object" &&
          !Array.isArray(uploaded) &&
          uploaded.item &&
          typeof uploaded.item === "object" &&
          !Array.isArray(uploaded.item) &&
          uploaded.item.id !== input.replace.itemId
        ) {
          await request(
            prefix + `library/items/${encodeURIComponent(String(uploaded.item.id))}/trash`,
            { method: "POST" },
          );
          throw new Error("This server cannot replace this item. Save a copy instead.");
        }
        return uploaded;
      }
      const input = mistyLibraryContracts[method].params.parse(message.params);
      if (input.operation !== "agentUsage" && input.args[0] !== scope.identity.spaceId)
        throw new AppRpcError("space_mismatch", "Open this Library in its owning Space.");
      scope.assert(input.operation === "agentUsage" ? "ai.read" : undefined);
      const action = api[input.operation as keyof typeof api] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      const value = await action(...input.args);
      scope.assert();
      if (method === "library.read") {
        const blob = value as Blob;
        return mistyLibraryContracts[method].result.parse({
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type,
        });
      }
      return mistyLibraryContracts[method].result.parse(value);
    },
  };
}
