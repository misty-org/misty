/**
 * Direct R2 downloads.
 *
 * When the server has direct transfer enabled, an authorized download endpoint
 * returns a short-lived signed descriptor instead of the file bytes. The client
 * then fetches the absolute R2 URL with no Misty cookies and no Authorization
 * header — the signature is the only credential, and sending Misty credentials
 * to a third-party origin would leak them.
 */
export const SIGNED_DOWNLOAD_HEADER = "X-Misty-Signed-Download";

export interface SignedDownloadDescriptor {
  url: string;
  expires_at: string;
  filename: string;
}

/**
 * Parses a descriptor body. Returns null when it is not a usable descriptor.
 */
export function parseSignedDownload(body: string): SignedDownloadDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const descriptor = parsed as Partial<SignedDownloadDescriptor>;
  // Only an absolute https URL is followed, so a malformed or relative value
  // can never be resolved against the Misty origin.
  if (typeof descriptor?.url !== "string" || !/^https:\/\//i.test(descriptor.url)) return null;
  return {
    url: descriptor.url,
    expires_at: typeof descriptor.expires_at === "string" ? descriptor.expires_at : "",
    filename: typeof descriptor.filename === "string" ? descriptor.filename : "download",
  };
}

/**
 * Returns the file bytes for an authorized download response.
 *
 * The marker header is checked before the body is touched, so a normal proxied
 * file is never read twice.
 */
export async function readDownloadBlob(response: Response): Promise<Blob> {
  if (response.headers.get(SIGNED_DOWNLOAD_HEADER) !== "1") return response.blob();
  const descriptor = parseSignedDownload(await response.text());
  if (!descriptor) throw new Error("The server returned an unusable download link.");
  const signed = await fetch(descriptor.url, { credentials: "omit", mode: "cors" });
  if (!signed.ok) {
    throw new Error("The cloud download failed. Check the R2 bucket CORS policy.");
  }
  return signed.blob();
}
