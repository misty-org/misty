const accepted = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const maxMistyImageBytes = 10 * 1024 * 1024;
export function validateMistyImage(file: File) {
  if (!accepted.has(file.type))
    throw new Error(`${file.name} must be an image, PDF, Word document, or text file.`);
  if (file.size > maxMistyImageBytes) throw new Error(`${file.name} is larger than 10 MB.`);
  if (!file.size) throw new Error(`${file.name} is empty.`);
}

export function captureToFile(capture: { dataUrl: string; name: string; mimeType: string }) {
  const [header, encoded] = capture.dataUrl.split(",", 2);
  const bytes = Uint8Array.from(atob(encoded ?? ""), (char) => char.charCodeAt(0));
  const type = /data:([^;]+)/.exec(header)?.[1] ?? capture.mimeType;
  return new File([bytes], capture.name, { type, lastModified: Date.now() });
}
