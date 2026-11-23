import { directApi } from "../api";
import { useDirectAccount } from "../direct_account";

const dbName = "misty-call-keys";
const storeName = "keys";
const recordId = "device";

interface DeviceKey {
  keyId: string;
  privateKey: CryptoKey;
  publicKey: string;
}

const curve = { name: "ECDH", namedCurve: "P-256" } as const;

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStored(): Promise<DeviceKey | undefined> {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).get(recordId);
    request.onsuccess = () => resolve(request.result as DeviceKey | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function writeStored(key: DeviceKey): Promise<void> {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(key, recordId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

let device: Promise<DeviceKey> | null = null;
let published = false;
let publishedFor: string | undefined;

export function deviceCallKey(): Promise<DeviceKey> {
  device ??= (async () => {
    const stored = await readStored().catch(() => undefined);
    if (stored) return stored;
    const pair = await crypto.subtle.generateKey(curve, false, ["deriveKey"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const made: DeviceKey = {
      keyId: crypto.randomUUID().replace(/-/g, ""),
      privateKey: pair.privateKey,
      publicKey: toBase64(raw),
    };
    await writeStored(made);
    return made;
  })().catch((error: unknown) => {
    device = null;
    throw error;
  });
  return device.then(async (key) => {
    const account = useDirectAccount.getState().userId;
    if (!published || publishedFor !== account) {
      await directApi.putCallKey(key.keyId, key.publicKey);
      published = true;
      publishedFor = account;
    }
    return key;
  });
}

export function forgetPublishedCallKey() {
  published = false;
}

useDirectAccount.subscribe((state, previous) => {
  if (!state.userId || state.userId === previous.userId || !publishedFor) return;
  void deviceCallKey().catch(() => undefined);
});

export function newCallKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function agreedKey(
  privateKey: CryptoKey,
  publicKeyRaw: Uint8Array<ArrayBuffer>,
  usage: KeyUsage,
) {
  const publicKey = await crypto.subtle.importKey("raw", publicKeyRaw, curve, false, []);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export async function sealCallKey(
  callKey: Uint8Array<ArrayBuffer>,
  recipientPublicKey: string,
): Promise<string> {
  const ephemeral = await crypto.subtle.generateKey(curve, true, ["deriveKey"]);
  const key = await agreedKey(ephemeral.privateKey, fromBase64(recipientPublicKey), "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, callKey));
  const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const out = new Uint8Array(ephemeralRaw.length + iv.length + sealed.length);
  out.set(ephemeralRaw, 0);
  out.set(iv, ephemeralRaw.length);
  out.set(sealed, ephemeralRaw.length + iv.length);
  return toBase64(out);
}

export async function openCallKey(sealed: string): Promise<Uint8Array<ArrayBuffer>> {
  const { privateKey } = await deviceCallKey();
  return openCallKeyWith(privateKey, sealed);
}

export async function openCallKeyWith(
  privateKey: CryptoKey,
  sealed: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = fromBase64(sealed);
  const ephemeralRaw = bytes.slice(0, 65);
  const iv = bytes.slice(65, 77);
  const ciphertext = bytes.slice(77);
  const key = await agreedKey(privateKey, ephemeralRaw, "decrypt");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
}

export async function sealForDm(dmId: string) {
  const own = await deviceCallKey();
  const callKey = newCallKey();
  const keys = await directApi.dmCallKeys(dmId);
  const sealedKeys: Record<string, string> = {};
  for (const key of keys) {
    if (key.key_id === own.keyId) continue;
    sealedKeys[key.key_id] = await sealCallKey(callKey, key.public_key);
  }
  return { callKey, sealedKeys, senderKeyId: own.keyId };
}

export async function openRingKey(sealedKeys: Record<string, string> | undefined) {
  const own = await deviceCallKey();
  const sealed = sealedKeys?.[own.keyId];
  return sealed ? openCallKey(sealed) : undefined;
}
