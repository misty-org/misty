import { Image } from "@tiptap/extension-image";
import type { JournalImageLease } from "@/features/journal/sdkJournalAssets";

/** Resolve authenticated attachments without storing signed URLs or image bytes in Yjs. */
export function journalImage(resolve: (reference: string) => Promise<JournalImageLease>) {
  return Image.extend({
    addNodeView() {
      return ({ node }) => {
        const image = document.createElement("img");
        let current = "",
          generation = 0,
          release: (() => void) | undefined;
        const update = (next: typeof node) => {
          if (next.type.name !== "image") return false;
          image.alt = typeof next.attrs.alt === "string" ? next.attrs.alt : "";
          image.title = typeof next.attrs.title === "string" ? next.attrs.title : "";
          for (const dimension of ["width", "height"]) {
            const value = Number(next.attrs[dimension]);
            if (Number.isFinite(value) && value > 0 && value <= 16384)
              image.setAttribute(dimension, String(value));
            else image.removeAttribute(dimension);
          }
          const source = typeof next.attrs.src === "string" ? next.attrs.src : "";
          if (source === current) return true;
          current = source;
          const revision = ++generation;
          release?.();
          release = undefined;
          image.removeAttribute("src");
          image.dataset.loading = "true";
          delete image.dataset.error;
          void resolve(source)
            .then((lease) => {
              if (revision !== generation) {
                lease.release();
                return;
              }
              release = lease.release;
              image.src = lease.url;
              delete image.dataset.loading;
            })
            .catch(() => {
              if (revision === generation) {
                image.dataset.error = "true";
                delete image.dataset.loading;
              }
            });
          return true;
        };
        update(node);
        return {
          dom: image,
          update,
          destroy() {
            generation++;
            release?.();
            release = undefined;
          },
        };
      };
    },
  }).configure({ allowBase64: false });
}
