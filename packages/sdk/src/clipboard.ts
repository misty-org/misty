import { MISTY_CLIPBOARD_PNG_MAX_BYTES, mistyClipboardContracts } from "@misty/contracts";
import type { MistyAppTransport } from "./transport.js";

export async function readClipboardImage(transport: MistyAppTransport): Promise<Blob | null> {
  const result = mistyClipboardContracts["clipboard.readImage"].result.parse(await transport.request({ method: "clipboard.readImage", params: {} }));
  if (!result) return null;
  const bytes = Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0));
  if (bytes.length > MISTY_CLIPBOARD_PNG_MAX_BYTES) throw new Error("Clipboard image exceeds 4 MB.");
  return new Blob([bytes], { type: result.mimeType });
}

/** A native PNG copy with the same device grant as clipboard.writeText. */
export async function writeClipboardImage(transport: MistyAppTransport, file: Blob): Promise<void> {
  if (file.type !== "image/png" || file.size < 1 || file.size > MISTY_CLIPBOARD_PNG_MAX_BYTES)
    throw new Error("Clipboard images must be PNG files of 4 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 16 * 1024)
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 16 * 1024)));
  const params = mistyClipboardContracts["clipboard.writeImage"].params.parse({ mimeType: "image/png", data: btoa(chunks.join("")) });
  await transport.request({ method: "clipboard.writeImage", params });
}
