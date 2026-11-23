export const SIGNED_DOWNLOAD_HEADER = "X-Misty-Signed-Download";

interface SignedDownloadDescriptor {
  url: string;
  expires_at: string;
  filename: string;
}

export function parseSignedDownload(body: string): SignedDownloadDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const descriptor = parsed as Partial<SignedDownloadDescriptor>;
  if (typeof descriptor?.url !== "string" || !/^https:\/\//i.test(descriptor.url)) return null;
  return {
    url: descriptor.url,
    expires_at: typeof descriptor.expires_at === "string" ? descriptor.expires_at : "",
    filename: typeof descriptor.filename === "string" ? descriptor.filename : "download",
  };
}

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
