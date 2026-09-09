import {
  isMistyMailCacheMethod,
  mistyMailCacheContracts,
  MailCacheSnapshotSchema,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";

export interface MailCacheBackend {
  serverBase: string;
  readSecret(): Promise<string | null>;
  read(key: string): Promise<string | null>;
  write(key: string, encrypted: string): Promise<void>;
  remove(key: string): Promise<void>;
  crypto?: Crypto;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const cacheAgeMs = 7 * 86400000;
const ciphertextMax = 48 * 1024 * 1024;
function base64(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
function unbase64(value: string): ArrayBuffer {
  const bytes = atob(value);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0)).buffer;
}

/** Account credentials and encryption stay in the host. Only parsed mailbox data crosses RPC. */
export function createMailCacheRpc(scope: AppRpcScope, backend: MailCacheBackend) {
  const cryptography = backend.crypto ?? crypto;
  const deployment = new URL(backend.serverBase);
  deployment.search = "";
  deployment.hash = "";
  const owner = JSON.stringify([
    deployment.href.replace(/\/+$/, ""),
    scope.identity.accountId,
    scope.identity.appId,
    scope.identity.spaceId ?? "",
  ]);
  const ownerBytes = encoder.encode(owner);
  const keyName = cryptography.subtle
    .digest("SHA-256", ownerBytes)
    .then(
      (bytes) =>
        `sdk-mail-v1-${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    );
  let queue = Promise.resolve<unknown>(undefined);
  const assert = (writing: boolean) => {
    scope.assert("mail.read");
    scope.assert(writing ? "storage.write" : "storage.read");
  };
  const encryptionKey = async () => {
    const secret = await backend.readSecret();
    scope.assert();
    if (!secret)
      throw new AppRpcError("session_required", "The mail cache requires a signed-in session.");
    const digest = await cryptography.subtle.digest(
      "SHA-256",
      encoder.encode(`misty-sdk-mail-cache-v1\0${owner}\0${secret}`),
    );
    return cryptography.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  };
  return {
    request(message: { method: string; params?: unknown }): Promise<unknown> {
      scope.assert();
      if (!isMistyMailCacheMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown mail cache method.");
      const method = message.method;
      const writing = method !== "mail.cache.read";
      assert(writing);
      const params = mistyMailCacheContracts[method].params.parse(message.params ?? {});
      const operation = queue
        .catch(() => undefined)
        .then(async () => {
          assert(writing);
          const key = await keyName;
          assert(writing);
          if (method === "mail.cache.clear") {
            await backend.remove(key);
            assert(true);
            return;
          }
          const secretKey = await encryptionKey();
          assert(writing);
          if (method === "mail.cache.write") {
            const data = (params as { data: unknown }).data;
            const snapshot = MailCacheSnapshotSchema.parse({
              version: 2,
              accountId: scope.identity.accountId,
              savedAt: new Date().toISOString(),
              data,
            });
            const iv = cryptography.getRandomValues(new Uint8Array(12));
            const ciphertext = await cryptography.subtle.encrypt(
              { name: "AES-GCM", iv, additionalData: ownerBytes },
              secretKey,
              encoder.encode(JSON.stringify(snapshot)),
            );
            assert(true);
            await backend.write(
              key,
              JSON.stringify({
                version: 1,
                iv: base64(iv),
                ciphertext: base64(new Uint8Array(ciphertext)),
              }),
            );
            assert(true);
            return;
          }
          const encoded = await backend.read(key);
          assert(false);
          if (!encoded || encoded.length > ciphertextMax) return null;
          try {
            const envelope = JSON.parse(encoded) as {
              version?: unknown;
              iv?: unknown;
              ciphertext?: unknown;
            };
            if (
              envelope.version !== 1 ||
              typeof envelope.iv !== "string" ||
              envelope.iv.length !== 16 ||
              typeof envelope.ciphertext !== "string"
            )
              return null;
            const iv = unbase64(envelope.iv);
            if (iv.byteLength !== 12) return null;
            const plaintext = await cryptography.subtle.decrypt(
              { name: "AES-GCM", iv, additionalData: ownerBytes },
              secretKey,
              unbase64(envelope.ciphertext),
            );
            assert(false);
            const snapshot = MailCacheSnapshotSchema.parse(JSON.parse(decoder.decode(plaintext)));
            const age = Date.now() - Date.parse(snapshot.savedAt);
            if (snapshot.accountId !== scope.identity.accountId || age < -60000 || age > cacheAgeMs)
              return null;
            return snapshot;
          } catch {
            assert(false);
            return null;
          }
        });
      queue = operation;
      return operation.catch((error) => {
        scope.assert();
        if (error instanceof AppRpcError) throw error;
        throw new AppRpcError("cache_unavailable", "The local mail cache is unavailable.");
      });
    },
  };
}
