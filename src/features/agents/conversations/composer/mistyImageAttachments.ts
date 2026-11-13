import { dataUrl, deleteLocalAttachment, saveLocalAttachment } from "./localAttachments";
import type { MistyImageAttachment } from "../state/conversationTypes";

import { validateMistyImage, maxMistyImageBytes } from "./mistyImageValues";
export { validateMistyImage, maxMistyImageBytes };

export async function uploadMistyImage(
  file: File,
  input: {
    conversationId?: string;
    onProgress?: (progress: number) => void;
  },
): Promise<MistyImageAttachment> {
  validateMistyImage(file);
  const originalBytes = await file.arrayBuffer();
  const decoded = file.type.startsWith("image/")
    ? await decodeImage(file)
    : { width: 1, height: 1 };
  let rendition: { file: File; width: number; height: number };
  if ("image" in decoded) rendition = await modelRendition(decoded, file.name);
  else if (file.type === "application/pdf") rendition = { file, width: 1, height: 1 };
  else {
    let text: string;
    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const { extractMistyDocumentText } = await import("./mistyDocumentText");
      text = await extractMistyDocumentText(originalBytes);
    } else text = await file.text();
    const renditionFile = new File([text], file.name + ".txt", { type: "text/plain" });
    if (!text.trim()) throw new Error("This document has no readable text.");
    if (renditionFile.size > 1024 * 1024)
      throw new Error("This document contains more than 1 MB of text. Attach a smaller section.");
    rendition = { file: renditionFile, width: 1, height: 1 };
  }
  const modelBytes = await rendition.file.arrayBuffer();
  const id = `attachment_${crypto.randomUUID()}`;
  input.onProgress?.(0.5);
  await saveLocalAttachment({
    id,
    name: file.name,
    mime_type: rendition.file.type,
    data_url: dataUrl(modelBytes, rendition.file.type),
    width: rendition.width,
    height: rendition.height,
    content_hash: await sha256(modelBytes),
    byte_size: file.size,
    created_at: new Date().toISOString(),
    original_mime_type: file.type,
    original_data_url: dataUrl(originalBytes, file.type),
  });
  input.onProgress?.(1);
  return {
    id,
    name: file.name,
    mimeType: file.type as MistyImageAttachment["mimeType"],
    byteSize: file.size,
    width: decoded.width,
    height: decoded.height,
    previewUrl: URL.createObjectURL(file),
    progress: 1,
    state: "ready",
  };
}

export async function deleteMistyImage(attachment: MistyImageAttachment) {
  if (attachment.previewUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
  if (!attachment.id.startsWith("draft-")) await deleteLocalAttachment(attachment);
}

async function decodeImage(
  file: File,
): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    // The decoded element remains usable after revoking its source object URL.
    URL.revokeObjectURL(url);
  }
}

async function modelRendition(
  decoded: { image: HTMLImageElement; width: number; height: number },
  filename: string,
) {
  const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Misty could not prepare that image.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(decoded.image, 0, 0, width, height);
  let quality = 0.86;
  let blob = await canvasBlob(canvas, quality);
  while (blob.size > 1024 * 1024 && quality > 0.46) {
    quality -= 0.1;
    blob = await canvasBlob(canvas, quality);
  }
  if (blob.size > 1024 * 1024) throw new Error(`${filename} could not be reduced for the model.`);
  return { file: new File([blob], `${filename}.model.jpg`, { type: "image/jpeg" }), width, height };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image conversion failed."))),
      "image/jpeg",
      quality,
    ),
  );
}

async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
