import type { AiCaptureAttachment } from "./types";

const maximumCaptureBytes = 950 * 1024;

export async function captureAttachmentFromDataUrl(
  dataUrl: string,
  width: number,
  height: number,
): Promise<AiCaptureAttachment> {
  const normalized = await constrainCaptureSize(dataUrl, width, height);
  dataUrl = normalized.dataUrl;
  width = normalized.width;
  height = normalized.height;
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const decoded = window.atob(encoded);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const contentHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id: crypto.randomUUID(),
    name: `Misty capture ${new Date().toLocaleTimeString()}`,
    mimeType: "image/jpeg",
    dataUrl,
    width,
    height,
    contentHash,
  };
}

async function constrainCaptureSize(dataUrl: string, width: number, height: number) {
  if (captureDataUrlByteLength(dataUrl) <= maximumCaptureBytes) {
    return { dataUrl, width, height };
  }
  const image = await loadCaptureImage(dataUrl);
  let scale = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Misty could not prepare that capture.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.72, 0.6, 0.5, 0.42]) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      if (captureDataUrlByteLength(candidate) <= maximumCaptureBytes) {
        return { dataUrl: candidate, width: canvas.width, height: canvas.height };
      }
    }
    scale *= 0.78;
  }
  throw new Error("That capture is too detailed to attach. Try selecting a smaller region.");
}

function loadCaptureImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Misty could not read that capture."));
    image.src = dataUrl;
  });
}

export function captureDataUrlByteLength(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}
