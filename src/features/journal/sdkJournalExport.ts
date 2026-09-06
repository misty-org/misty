import type { MistyAppSDK } from "@misty/sdk";

/** A staged copy in a user-picked directory; the app never receives a native path. */
export async function exportSdkJournalFile(
  misty: MistyAppSDK,
  signal: AbortSignal,
  file: Blob,
  filename: string,
): Promise<boolean> {
  if (signal.aborted) return false;
  if (file.size < 1 || file.size > 64 * 1024 * 1024)
    throw new Error("This export exceeds the supported file size.");
  const directory = await misty.files.pickDirectory({ write: true });
  if (!directory) return false;
  let draft: string | undefined;
  try {
    if (signal.aborted) return false;
    const name =
      [...filename]
        .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
        .join("")
        .replace(/[\\/:*?"<>|]/g, "-")
        .slice(0, 240) || "Drawing.png";
    draft = (await misty.files.createCopy(directory.handle, name)).handle;
    for (let offset = 0; offset < file.size; offset += 64 * 1024) {
      if (signal.aborted) return false;
      const bytes = await file.slice(offset, offset + 64 * 1024).arrayBuffer();
      if (signal.aborted) return false;
      await misty.files.appendCopy(draft, bytes);
    }
    if (signal.aborted) return false;
    await misty.files.commitCopy(draft);
    draft = undefined;
    return true;
  } finally {
    if (draft) await misty.files.discardCopy(draft).catch(() => undefined);
    await misty.files.release(directory.handle).catch(() => undefined);
  }
}
