import { readApiAuthToken } from "@/api/client/session";
import type { MailAccount, MailFolder } from "@/api/mail";
import { mailCacheRead, mailCacheRemove, mailCacheWrite } from "@/native/runtime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { InboxThread } from "../model";

const cacheVersion = 2;
const cacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const maxThreadsPerConnection = 200;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface InboxCacheSnapshot {
  version: 2;
  accountId: string;
  savedAt: string;
  accounts: MailAccount[];
  foldersByConnection: Record<string, MailFolder[]>;
  threadsByConnection: Record<string, InboxThread[]>;
  nextPageByConnection: Record<string, string | undefined>;
  estimatedTotalByConnection: Record<string, number>;
  detailFetchedAtByThread: Record<string, number>;
}

interface EncryptedInboxCache {
  version: 2;
  accountId: string;
  iv: string;
  ciphertext: string;
}

let writeQueue = Promise.resolve();

export async function readInboxCache(accountId: string): Promise<InboxCacheSnapshot | null> {
  const normalized = accountId.trim();
  if (!normalized || !hasTauriInternals()) return null;
  try {
    const encoded = await mailCacheRead(normalized);
    if (!encoded) return null;
    const encrypted = JSON.parse(encoded) as EncryptedInboxCache;
    if (encrypted.version !== cacheVersion || encrypted.accountId !== normalized) return null;
    const key = await cacheEncryptionKey(normalized);
    if (!key) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encrypted.iv) },
      key,
      fromBase64(encrypted.ciphertext),
    );
    const snapshot = JSON.parse(decoder.decode(plaintext)) as InboxCacheSnapshot;
    if (!validSnapshot(snapshot, normalized) || !cacheIsFresh(snapshot)) {
      await mailCacheRemove(normalized);
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function persistInboxCache(
  accountId: string,
  state: Omit<InboxCacheSnapshot, "version" | "accountId" | "savedAt">,
): void {
  const normalized = accountId.trim();
  if (!normalized || !hasTauriInternals()) return;
  const snapshot: InboxCacheSnapshot = {
    version: cacheVersion,
    accountId: normalized,
    savedAt: new Date().toISOString(),
    accounts: state.accounts,
    foldersByConnection: state.foldersByConnection,
    threadsByConnection: Object.fromEntries(
      Object.entries(state.threadsByConnection).map(([connectionId, threads]) => [
        connectionId,
        threads.slice(0, maxThreadsPerConnection),
      ]),
    ),
    nextPageByConnection: state.nextPageByConnection,
    estimatedTotalByConnection: state.estimatedTotalByConnection,
    detailFetchedAtByThread: state.detailFetchedAtByThread,
  };
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const key = await cacheEncryptionKey(normalized);
      if (!key) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(JSON.stringify(snapshot)),
      );
      const encrypted: EncryptedInboxCache = {
        version: cacheVersion,
        accountId: normalized,
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext)),
      };
      await mailCacheWrite(normalized, JSON.stringify(encrypted));
    });
}

async function cacheEncryptionKey(accountId: string): Promise<CryptoKey | null> {
  const token = await readApiAuthToken();
  if (!token) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`misty-inbox-cache-v1\0${accountId}\0${token}`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function validSnapshot(
  snapshot: InboxCacheSnapshot,
  accountId: string,
): snapshot is InboxCacheSnapshot {
  return (
    snapshot?.version === cacheVersion &&
    snapshot.accountId === accountId &&
    Array.isArray(snapshot.accounts) &&
    isRecord(snapshot.foldersByConnection) &&
    isRecord(snapshot.threadsByConnection) &&
    isRecord(snapshot.nextPageByConnection) &&
    isRecord(snapshot.estimatedTotalByConnection) &&
    isRecord(snapshot.detailFetchedAtByThread)
  );
}

function cacheIsFresh(snapshot: InboxCacheSnapshot): boolean {
  const savedAt = new Date(snapshot.savedAt).getTime();
  return Number.isFinite(savedAt) && Date.now() - savedAt <= cacheMaxAgeMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
