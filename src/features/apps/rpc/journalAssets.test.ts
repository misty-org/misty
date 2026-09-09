import { Blob as NodeBlob } from "node:buffer";
import {
  createMistyAppSDK,
  MISTY_JOURNAL_ASSET_CHUNK_BYTES,
  MISTY_JOURNAL_ASSET_MAX_BYTES,
} from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createJournalAssetsRpc } from "./journalAssets";
import { createAppRpcScope } from "./session";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
  vi.unstubAllGlobals();
});
const expires = () => new Date(Date.now() + 60_000).toISOString();
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
function fixture(scopes = ["notes.read", "notes.write", "drawings.read", "drawings.write"]) {
  const scope = createAppRpcScope({
    identity: {
      appId: "journal",
      accountId: "a",
      spaceId: "space-a",
      instanceId: crypto.randomUUID(),
    },
    scopes,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const server = {
    request: vi.fn(
      async (
        _message: { method: string; params?: unknown },
        _options?: { signal?: AbortSignal; journalUploadToken?: string },
      ): Promise<unknown> => ({}),
    ),
  };
  const network = vi.fn<typeof fetch>();
  const rpc = createJournalAssetsRpc(scope, server, network);
  const transport = vi.fn(async (message: { method: string; params?: unknown }) =>
    message.method === "lifecycle.ready" ? undefined : rpc.request(message),
  );
  const sdk = createMistyAppSDK({ request: transport });
  cleanups.push(() => scope.close());
  return { scope, server, network, rpc, sdk, transport };
}
function reservation() {
  return {
    upload: { id: "upload-a", internal_storage_key: "host-only" },
    transfer: {
      url: "https://r2.example/object?signature=private",
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      expires_at: expires(),
    },
    finalize: { headers: { "X-Misty-Library-Upload-Token": "private-finalize-token" } },
  };
}
const begin = {
  resource: "note" as const,
  resourceId: "note-a",
  filename: "image.png",
  mimeType: "image/png" as const,
  bytes: 3,
};
it("uploads SDK chunks and exposes only verified asset metadata, keeping both credentials in the host", async () => {
  const f = fixture();
  const bytes = new Uint8Array(MISTY_JOURNAL_ASSET_CHUNK_BYTES + 8).fill(123);
  const sha256 = await hash(bytes);
  f.server.request
    .mockResolvedValueOnce(reservation())
    .mockResolvedValueOnce({
      note_asset: {
        id: "asset-a",
        mime_type: "image/png",
        byte_size: bytes.length,
        sha256,
        secret_extra: "strip",
      },
    });
  f.network.mockResolvedValue(new Response(null, { status: 200 }));
  const file = new NodeBlob([bytes], { type: "image/png" }) as Blob;
  const result = await f.sdk.journal.assets.upload({
    resource: "note",
    resourceId: "note-a",
    filename: "image.png",
    file,
  });
  expect(result).toEqual({
    id: "asset-a",
    mime_type: "image/png",
    byte_size: bytes.length,
    sha256,
  });
  expect(f.transport.mock.calls.filter(([x]) => x.method === "journal.assets.write")).toHaveLength(
    2,
  );
  expect(f.server.request.mock.calls[0][0]).toEqual({
    method: "notes.assets.reserve",
    params: {
      path: { noteID: "note-a" },
      body: { filename: "image.png", mime_type: "image/png", byte_size: bytes.length, sha256 },
    },
  });
  expect(f.server.request.mock.calls[1][1]?.journalUploadToken).toBe("private-finalize-token");
  const init = f.network.mock.calls[0][1]!;
  expect(new Headers(init.headers).has("authorization")).toBe(false);
  expect(new Headers(init.headers).has("x-misty-library-upload-token")).toBe(false);
  expect(init.credentials).toBe("omit");
  expect(init.redirect).toBe("error");
  expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(bytes);
  const appMessages = JSON.stringify(f.transport.mock.calls) + JSON.stringify(result);
  expect(appMessages).not.toMatch(/private-finalize|signature=|host-only/);
});
it("downloads bounded verified bytes through SDK handles and closes the handle afterward", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  const f = fixture(),
    bytes = Uint8Array.from([0, 1, 255]),
    sha256 = await hash(bytes);
  f.server.request.mockResolvedValue({
    url: "https://r2.example/object?signature=private",
    expires_at: expires(),
    filename: "image.png",
    mime_type: "image/png",
    byte_size: 3,
    sha256,
  });
  f.network.mockResolvedValue(new Response(bytes));
  const result = await f.sdk.journal.assets.download({
    resource: "note",
    resourceId: "note-a",
    assetId: "asset-a",
  });
  expect(new Uint8Array(await result.file.arrayBuffer())).toEqual(bytes);
  expect(result.sha256).toBe(sha256);
  const closeMessage = f.transport.mock.calls[f.transport.mock.calls.length - 1][0];
  expect(closeMessage.method).toBe("journal.assets.close");
  await expect(
    f.rpc.request({
      method: "journal.assets.read",
      params: { ...(closeMessage.params as object), offset: 0, length: 1 },
    }),
  ).rejects.toMatchObject({ code: "resource_denied" });
});
it("enforces permissions, exact sequential chunks, ownership, MIME and memory limits before network access", async () => {
  const denied = fixture([]);
  await expect(
    denied.rpc.request({ method: "journal.assets.begin", params: begin }),
  ).rejects.toMatchObject({ code: "capability_denied" });
  const f = fixture(),
    other = fixture();
  const handle = (await f.rpc.request({ method: "journal.assets.begin", params: begin })) as {
    handle: string;
  };
  await expect(
    other.rpc.request({
      method: "journal.assets.write",
      params: { ...handle, offset: 0, data: "AA==" },
    }),
  ).rejects.toMatchObject({ code: "resource_denied" });
  await expect(
    f.rpc.request({
      method: "journal.assets.write",
      params: { ...handle, offset: 1, data: "AA==" },
    }),
  ).rejects.toMatchObject({ code: "invalid_chunk" });
  await expect(
    f.rpc.request({ method: "journal.assets.commit", params: handle }),
  ).rejects.toMatchObject({ code: "transfer_incomplete" });
  await expect(
    f.rpc.request({
      method: "journal.assets.begin",
      params: { ...begin, mimeType: "image/svg+xml" },
    }),
  ).rejects.toThrow();
  await expect(
    f.rpc.request({
      method: "journal.assets.begin",
      params: { ...begin, bytes: MISTY_JOURNAL_ASSET_MAX_BYTES + 1 },
    }),
  ).rejects.toThrow();
  await f.rpc.request({ method: "journal.assets.begin", params: begin });
  await expect(
    f.rpc.request({ method: "journal.assets.begin", params: begin }),
  ).rejects.toMatchObject({ code: "transfer_limit" });
  expect(f.server.request).not.toHaveBeenCalled();
  expect(f.network).not.toHaveBeenCalled();
});
it("cancels a pending reservation on close and never starts a late signed transfer", async () => {
  const f = fixture();
  const handle = (await f.rpc.request({ method: "journal.assets.begin", params: begin })) as {
    handle: string;
  };
  await f.rpc.request({
    method: "journal.assets.write",
    params: { ...handle, offset: 0, data: "AAH/" },
  });
  let finish!: (value: unknown) => void;
  f.server.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const commit = f.rpc.request({ method: "journal.assets.commit", params: handle });
  const rejected = expect(commit).rejects.toMatchObject({ code: "app_closed" });
  await vi.waitFor(() => expect(f.server.request).toHaveBeenCalledOnce());
  f.scope.close();
  expect(f.server.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  finish(reservation());
  await rejected;
  expect(f.network).not.toHaveBeenCalled();
});
it.each(["short", "overflow", "checksum"])(
  "rejects %s downloads and releases their transfer slots",
  async (kind) => {
    const f = fixture();
    f.server.request.mockResolvedValue({
      url: "https://r2.example/file",
      expires_at: expires(),
      filename: "image.png",
      mime_type: "image/png",
      byte_size: 3,
      sha256: "0".repeat(64),
    });
    f.network.mockImplementation(
      async () => new Response(new Uint8Array(kind === "short" ? 2 : kind === "overflow" ? 4 : 3)),
    );
    for (let attempt = 0; attempt < 3; attempt++)
      await expect(
        f.sdk.journal.assets.download({
          resource: "note",
          resourceId: "note-a",
          assetId: "asset-a",
        }),
      ).rejects.toMatchObject({ code: kind === "checksum" ? "asset_checksum" : "asset_size" });
  },
);
it("sanitizes signed network failures and rejects credentials in storage transfer headers", async () => {
  const f = fixture();
  f.server.request.mockResolvedValue({
    url: "https://r2.example/file?signature=secret",
    expires_at: expires(),
    filename: "image.png",
    mime_type: "image/png",
    byte_size: 3,
    sha256: "0".repeat(64),
  });
  f.network.mockRejectedValue(new Error("failed https://r2.example/file?signature=secret"));
  await expect(
    f.sdk.journal.assets.download({ resource: "note", resourceId: "note-a", assetId: "asset-a" }),
  ).rejects.toThrow("The Journal asset transfer failed. Please try again.");
  f.network.mockClear();
  const bad = reservation();
  Object.assign(bad.transfer.headers, { Authorization: "do-not-forward" });
  f.server.request.mockResolvedValue(bad);
  await expect(
    f.sdk.journal.assets.upload({
      resource: "note",
      resourceId: "note-a",
      filename: "image.png",
      file: new NodeBlob([new Uint8Array(3)], { type: "image/png" }) as Blob,
    }),
  ).rejects.toMatchObject({ code: "invalid_transfer_headers" });
  expect(f.network).not.toHaveBeenCalled();
});
