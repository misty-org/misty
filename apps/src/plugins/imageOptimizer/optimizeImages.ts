import type { MistyAppSDK, MistyFileHandle } from "@misty/sdk";
export type OptimizeOptions = { quality: "small" | "balanced" | "high"; maxDimension: number | null };
export type OptimizeRow = { source: string; output?: string; originalBytes: number; outputBytes?: number; status: "completed" | "failed"; message?: string };
export type OptimizeResult = { originalBytes: number; outputBytes: number; files: OptimizeRow[] };
const CHUNK = 65_536;
const MAX_IMAGE = 67_108_864;
export const supportedImagePath = (name: string) => /\.(jpe?g|png|webp)$/i.test(name);
export type ImageEncoder = (input: Blob, options: OptimizeOptions, signal: AbortSignal) => Promise<Blob>;

/** Codec runs in the isolated App view; all I/O uses instance-owned handles. */
export async function optimizeImages(
  sdk: MistyAppSDK,
  files: readonly MistyFileHandle[],
  directory: string,
  options: OptimizeOptions,
  signal: AbortSignal,
  progress: (result: OptimizeResult) => void,
  encode: ImageEncoder = encodeImage,
): Promise<OptimizeResult> {
  if (!files.length || files.length > 64) throw new Error("Choose between one and 64 images.");
  const result: OptimizeResult = { originalBytes: 0, outputBytes: 0, files: [] };
  for (const file of files) {
    signal.throwIfAborted();
    let draft = "";
    try {
      if (!supportedImagePath(file.name)) throw new Error("Choose JPEG, PNG, or WebP images.");
      if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_IMAGE)
        throw new Error("Choose an image no larger than 64 MB.");
      const chunks: ArrayBuffer[] = [];
      for (let offset = 0; offset < file.bytes;) {
        signal.throwIfAborted();
        const bytes = await sdk.files.readBytes(file.handle, offset, Math.min(CHUNK, file.bytes - offset));
        signal.throwIfAborted();
        if (!bytes.byteLength || bytes.byteLength > Math.min(CHUNK, file.bytes - offset)) throw new Error("The chosen file changed. Choose it again.");
        chunks.push(bytes); offset += bytes.byteLength;
      }
      const mime = /\.webp$/i.test(file.name) ? "image/webp" : /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
      const input = new Blob(chunks, { type: mime });
      const output = await encode(input, options, signal);
      signal.throwIfAborted();
      const suffix = output.type === "image/png" ? "png" : output.type === "image/webp" ? "webp" : "jpg";
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 125) + `_optimized.${suffix}`;
      draft = (await sdk.files.createCopy(directory, name)).handle;
      for (let offset = 0; offset < output.size; offset += CHUNK) {
        signal.throwIfAborted();
        await sdk.files.appendCopy(draft, await output.slice(offset, offset + CHUNK).arrayBuffer());
      }
      signal.throwIfAborted();
      const saved = await sdk.files.commitCopy(draft);
      draft = "";
      result.originalBytes += file.bytes; result.outputBytes += saved.bytes;
      result.files.push({ source: file.name, output: saved.name, originalBytes: file.bytes, outputBytes: saved.bytes, status: "completed" });
    } catch (error) {
      signal.throwIfAborted();
      result.files.push({ source: file.name, originalBytes: file.bytes, status: "failed", message: String(error) });
    } finally {
      if (draft) await sdk.files.discardCopy(draft).catch(() => undefined);
    }
    progress({ ...result, files: [...result.files] });
  }
  return result;
}

export async function encodeImage(input: Blob, options: OptimizeOptions, signal: AbortSignal): Promise<Blob> {
  const url = URL.createObjectURL(input);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        clearTimeout(timer); signal.removeEventListener("abort", abort);
        image.onload = null; image.onerror = null;
        if (error) reject(error); else resolve();
      };
      const abort = () => done(new Error("Optimization cancelled."));
      const timer = window.setTimeout(() => done(new Error("Image decoding took too long.")), 30_000);
      image.onload = () => done(); image.onerror = () => done(new Error("This image could not be decoded."));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort(); else image.src = url;
    });
    signal.throwIfAborted();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000)
      throw new Error("Choose an image with no more than 32 million pixels.");
    const scale = options.maxDimension == null ? 1 : Math.min(1, options.maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable in this App window.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    try {
      const quality = options.quality === "small" ? 0.68 : options.quality === "high" ? 0.88 : 0.78;
      const output = await new Promise<Blob>((resolve, reject) => {
        let settled = false;
        const done = (blob?: Blob, error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer); signal.removeEventListener("abort", abort);
          if (error || !blob) reject(error ?? new Error("Could not encode this image.")); else resolve(blob);
        };
        const abort = () => done(undefined, new Error("Optimization cancelled."));
        const timer = window.setTimeout(() => done(undefined, new Error("Image encoding took too long.")), 30_000);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        else {
          try { canvas.toBlob(blob => done(blob ?? undefined), input.type, quality); }
          catch (error) { done(undefined, new Error(String(error))); }
        }
      });
      signal.throwIfAborted();
      // Some WebViews fall back to PNG for unsupported encoders. Keep the
      // original bytes when resizing is unnecessary and a smaller copy is unavailable.
      return scale === 1 && (output.size >= input.size || output.type !== input.type) ? input : output;
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { image.src = ""; URL.revokeObjectURL(url); }
}
