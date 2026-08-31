import { apiRequest, readApiSessionGeneration } from "@/api/client";
import { transferLibraryObject } from "@/api/spaces/library-upload";
import type { MistyImageAttachment } from "./types";

const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
export const maxMistyImageBytes = 10 * 1024 * 1024;

interface Transfer {
  url: string;
  method?: string;
  headers: Record<string, string>;
}

interface AttachmentResponse {
  id: string;
  name: string;
  mime_type: MistyImageAttachment["mimeType"];
  byte_size: number;
  width: number;
  height: number;
  state: string;
  preview_url: string;
}

export function validateMistyImage(file: File) {
  if (!accepted.has(file.type)) throw new Error(`${file.name} must be a JPEG, PNG, or WebP image.`);
  if (file.size > maxMistyImageBytes) throw new Error(`${file.name} is larger than 10 MB.`);
  if (!file.size) throw new Error(`${file.name} is empty.`);
}

export async function uploadMistyImage(
  file: File,
  input: {
    conversationId?: string;
    scope: "conversation" | "visual_query";
    onProgress?: (progress: number) => void;
  },
): Promise<MistyImageAttachment> {
  validateMistyImage(file);
  const originalBytes = await file.arrayBuffer();
  const originalHash = await sha256(originalBytes);
  const decoded = await decodeImage(file);
  const rendition = await modelRendition(decoded, file.name);
  const modelBytes = await rendition.file.arrayBuffer();
  const modelHash = await sha256(modelBytes);
  const initiated = await apiRequest<{
    attachment: AttachmentResponse;
    original_transfer: Transfer;
    model_transfer: Transfer;
  }>("/misty/attachments", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: input.conversationId,
      scope: input.scope,
      filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
      sha256: originalHash,
      width: decoded.width,
      height: decoded.height,
      model_mime_type: rendition.file.type,
      model_byte_size: rendition.file.size,
      model_sha256: modelHash,
      model_width: rendition.width,
      model_height: rendition.height,
    }),
  });
  const generation = readApiSessionGeneration();
  try {
    await transferLibraryObject(initiated.original_transfer, file, generation, {
      onProgress: (value) => input.onProgress?.(value * 0.72),
    });
    await transferLibraryObject(initiated.model_transfer, rendition.file, generation, {
      onProgress: (value) => input.onProgress?.(0.72 + value * 0.28),
    });
    const completed = await apiRequest<AttachmentResponse>(
      `/misty/attachments/${encodeURIComponent(initiated.attachment.id)}/finalize`,
      { method: "POST" },
    );
    input.onProgress?.(1);
    return {
      id: completed.id,
      name: completed.name,
      mimeType: completed.mime_type,
      byteSize: completed.byte_size,
      width: completed.width,
      height: completed.height,
      previewUrl: URL.createObjectURL(file),
      progress: 1,
      state: "ready",
    };
  } catch (error) {
    await apiRequest(`/misty/attachments/${encodeURIComponent(initiated.attachment.id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    throw error;
  }
}

export async function deleteMistyImage(attachment: MistyImageAttachment) {
  if (attachment.previewUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
  if (!attachment.id.startsWith("draft-")) {
    await apiRequest(`/misty/attachments/${encodeURIComponent(attachment.id)}`, {
      method: "DELETE",
    });
  }
}

export function captureToFile(capture: { dataUrl: string; name: string; mimeType: string }) {
  const [header, encoded] = capture.dataUrl.split(",", 2);
  const bytes = Uint8Array.from(atob(encoded ?? ""), (char) => char.charCodeAt(0));
  const type = /data:([^;]+)/.exec(header)?.[1] ?? capture.mimeType;
  return new File([bytes], capture.name, { type, lastModified: Date.now() });
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
