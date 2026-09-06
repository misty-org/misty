import { MISTY_MAIL_CONTENT_MAX_BYTES, type MistyAppSDK } from "@misty/sdk";
const mimeTypes: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  zip: "application/zip",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
/** Native picks stay opaque; every bounded read is scoped and every handle is released. */
export async function pickSdkInboxFiles(misty: MistyAppSDK, signal: AbortSignal): Promise<File[]> {
  const assert = () => {
    if (signal.aborted)
      throw new DOMException("The attachment selection was cancelled.", "AbortError");
  };
  assert();
  const picked = await misty.files.pickMany();
  try {
    assert();
    if (
      picked.length > 100 ||
      picked.some((file) => !Number.isSafeInteger(file.bytes) || file.bytes < 0) ||
      picked.reduce((size, file) => size + file.bytes, 0) > MISTY_MAIL_CONTENT_MAX_BYTES
    )
      throw new Error("Choose attachments totaling 10 MiB or smaller.");
    const files: File[] = [];
    for (const selected of picked) {
      const parts: ArrayBuffer[] = [];
      for (let offset = 0; offset < selected.bytes; offset += 64 * 1024) {
        assert();
        const length = Math.min(64 * 1024, selected.bytes - offset);
        const bytes = await misty.files.readBytes(selected.handle, offset, length);
        assert();
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== length)
          throw new Error("The attachment changed while reading.");
        parts.push(bytes);
      }
      assert();
      const extension = selected.name.split(".").pop()?.toLowerCase() ?? "";
      files.push(
        new File(parts, selected.name, {
          type: mimeTypes[extension] ?? "application/octet-stream",
        }),
      );
    }
    return files;
  } finally {
    await Promise.all(
      picked.map((file) => misty.files.release(file.handle).catch(() => undefined)),
    );
  }
}
