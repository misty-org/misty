import type { SdkFilesStore } from "./sdkFilesStore";
import { createGridThumbnailQueue } from "./explorer/components/fileBrowser/createGridThumbnailQueue";

/** Thumbnail bytes come from owned file grants; decoded image URLs live only in this view. */
export function createSdkFilesThumbnails(files: SdkFilesStore, signal: AbortSignal) {
  const lifetime = new AbortController();
  const assert = () => {
    if (lifetime.signal.aborted) throw new DOMException("Files preview closed.", "AbortError");
  };
  const queue = createGridThumbnailQueue(
    async (entry, maxDimension) => {
      assert();
      const bytes = await files.readBytes(entry.path, 64 * 1024 * 1024);
      assert();
      const source = URL.createObjectURL(new Blob([bytes]));
      const image = new Image();
      const cancel = () => {
        image.src = "";
      };
      lifetime.signal.addEventListener("abort", cancel, { once: true });
      try {
        image.src = source;
        await image.decode();
        assert();
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image previews are unavailable.");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Could not create image preview."))),
            "image/png",
          ),
        );
        assert();
        return URL.createObjectURL(png);
      } finally {
        lifetime.signal.removeEventListener("abort", cancel);
        URL.revokeObjectURL(source);
        image.src = "";
      }
    },
    (url) => URL.revokeObjectURL(url),
  );
  const unsubscribe = files.store.subscribe((state, previous) => {
    if (state.pane.listing !== previous.pane.listing) queue.clear();
  });
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    lifetime.abort();
    queue.close();
    unsubscribe();
    signal.removeEventListener("abort", close);
  }
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) close();
  return {
    prewarmThumbnails: queue.prewarmGridThumbnails,
    requestThumbnail: queue.requestGridThumbnail,
    close,
  };
}
