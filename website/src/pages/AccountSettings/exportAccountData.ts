import { strToU8, Zip, ZipPassThrough } from "fflate";

import type { AccountExportManifest } from "./api";

/**
 * Builds the export archive in the browser and starts the download.
 *
 * This module is imported dynamically so `fflate` never lands in the main
 * bundle — almost nobody exports their account, and the settings dialog loads
 * on every page.
 */
export async function buildAccountExportArchive(
  manifest: AccountExportManifest,
): Promise<void> {
  const blob = await zipManifest(manifest);
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

async function zipManifest(manifest: AccountExportManifest): Promise<Blob> {
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

async function populateArchive(
  archive: Zip,
  manifest: AccountExportManifest,
): Promise<void> {
  const documents = manifest.documents ?? [];
  const assets = manifest.assets ?? [];

  // The signed download URLs are short-lived, so they are stripped from the
  // copy that ships inside the archive.
  const portableManifest = {
    format_version: 1,
    generated_at: new Date().toISOString(),
    account_data: manifest.account_data,
    documents: documents.map((item) => ({
      kind: item.kind,
      id: item.id,
      space_id: item.space_id,
      title: item.title,
      acl_version: item.acl_version,
      created_at: item.created_at,
      updated_at: item.updated_at,
    })),
    assets: assets.map((item) => ({
      kind: item.kind,
      id: item.id,
      parent_id: item.parent_id,
      filename: item.filename,
      mime_type: item.mime_type,
      byte_size: item.byte_size,
      sha256: item.sha256,
      created_at: item.created_at,
    })),
    journal_format:
      "Raw Yjs update; apply with Y.applyUpdate to an empty Y.Doc.",
  };
  addBytes(
    archive,
    "manifest.json",
    strToU8(`${JSON.stringify(portableManifest, null, 2)}\n`),
  );

  for (const document of documents) {
    const bytes = await fetchBytes(document.download_url);
    addBytes(
      archive,
      `journal/${document.kind}s/${safeSegment(document.id)}.yjs`,
      bytes,
    );
  }

  for (const asset of assets) {
    const bytes = await fetchBytes(asset.download.url);
    // The archive is the user's record of their own data; a truncated or
    // corrupted download must fail loudly rather than be silently packaged.
    if (bytes.byteLength !== asset.byte_size) {
      throw new Error(`Export asset ${asset.id} did not match its expected size.`);
    }
    if ((await sha256Hex(bytes)) !== asset.sha256.toLowerCase()) {
      throw new Error(
        `Export asset ${asset.id} did not match its expected checksum.`,
      );
    }
    addBytes(
      archive,
      `assets/${asset.kind}s/${safeSegment(asset.id)}-${safeSegment(asset.filename)}`,
      bytes,
    );
  }

  archive.end();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
