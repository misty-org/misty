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
      const bytes = await files.previewImage(entry.path, maxDimension);
      assert();
      return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
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
