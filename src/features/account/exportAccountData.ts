import { strToU8, Zip, ZipPassThrough } from "fflate";

import type { AccountExportManifest } from "@/models/interfaces/stores/account/useAccountStore";
import { accountRequestExportManifest } from "@/stores/account/useAccountStore";

export async function exportAccountData(password: string): Promise<void> {
  const manifest = await accountRequestExportManifest(password);
  const blob = await buildAccountExportArchive(manifest);
  const objectURL = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectURL;
    anchor.download = `misty-account-export-${new Date().toISOString().slice(0, 10)}.zip`;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectURL), 30_000);
  }
}

export async function buildAccountExportArchive(manifest: AccountExportManifest): Promise<Blob> {
  const output: Uint8Array[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    const archive = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      output.push(chunk);
      if (final) resolve();
    });
    void populateArchive(archive, manifest).catch(reject);
  });
  await completed;
  return new Blob(output as BlobPart[], { type: "application/zip" });
}

async function populateArchive(archive: Zip, manifest: AccountExportManifest): Promise<void> {
  const portableManifest = {
    format_version: 1,
    generated_at: new Date().toISOString(),
    account_data: manifest.account_data,
    documents: manifest.documents.map(
      ({ download_url: _url, expires_at: _expires, ...item }) => item,
    ),
    assets: manifest.assets.map(({ download: _download, ...item }) => item),
    journal_format: "Raw Yjs update; apply with Y.applyUpdate to an empty Y.Doc.",
  };
  addBytes(archive, "manifest.json", strToU8(`${JSON.stringify(portableManifest, null, 2)}\n`));

  for (const document of manifest.documents) {
    const bytes = await fetchBytes(document.download_url);
    addBytes(archive, `journal/${document.kind}s/${safeSegment(document.id)}.yjs`, bytes);
  }
  for (const asset of manifest.assets) {
    const bytes = await fetchBytes(asset.download.url);
    if (bytes.byteLength !== asset.byte_size) {
      throw new Error(`Export asset ${asset.id} did not match its expected size.`);
    }
    if ((await sha256Hex(bytes)) !== asset.sha256.toLowerCase()) {
      throw new Error(`Export asset ${asset.id} did not match its expected checksum.`);
    }
    addBytes(
      archive,
      `assets/${asset.kind}s/${safeSegment(asset.id)}-${safeSegment(asset.filename)}`,
      bytes,
    );
  }
  archive.end();
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Account export download failed (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function addBytes(archive: Zip, path: string, bytes: Uint8Array): void {
  const file = new ZipPassThrough(path);
  archive.add(file);
  file.push(bytes, true);
}

function safeSegment(value: string): string {
  const leaf = value.split(/[\\/]/).pop() ?? value;
  const cleaned = leaf
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "item";
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
