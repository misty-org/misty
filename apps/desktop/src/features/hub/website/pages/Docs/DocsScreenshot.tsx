import type { SectionScreenshot } from "./types";

export default function DocsScreenshot({
  screenshot,
}: {
  screenshot: SectionScreenshot;
}) {
  return (
    <figure
      id={screenshot.id}
      className="my-8 scroll-mt-20 overflow-hidden rounded-lg border border-border bg-surface/30"
    >
      {screenshot.src ? (
        <img
          src={screenshot.src}
          alt={screenshot.alt}
          className="block w-full"
        />
      ) : (
        <div className="flex h-64 w-full items-center justify-center border border-dashed border-border bg-surface/40">
          <span className="px-4 text-center text-xs text-text-muted">
            Screenshot - {screenshot.alt}
          </span>
        </div>
      )}
      {screenshot.caption && (
        <figcaption className="border-t border-border px-4 py-3 text-sm leading-relaxed text-text-muted">
          {screenshot.caption}
        </figcaption>
      )}
    </figure>
  );
}
