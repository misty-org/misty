import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/ui";

// Bundle the pdf.js worker as a same-origin asset so it loads under the app's
// strict CSP (no external script hosts). Its version is pinned to react-pdf's
// pdfjs-dist so the worker and API versions always match.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PAGE_WIDTH = 900;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;

export default function PdfViewer({
  url,
  name,
  compact = false,
}: {
  url: string;
  name: string;
  /** Toolbar-less, first-page-only rendering for small embedded previews. */
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageNodes = useRef(new Map<number, HTMLDivElement>());
  const [baseWidth, setBaseWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () =>
      setBaseWidth(Math.min(element.clientWidth - (compact ? 16 : 48), MAX_PAGE_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

  // Keep the page indicator in sync with whatever page is most in view.
  useEffect(() => {
    if (compact) return;
    const root = scrollRef.current;
    if (!root || numPages === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const pageNumber = Number((mostVisible?.target as HTMLElement | undefined)?.dataset.page);
        if (pageNumber) setCurrentPage(pageNumber);
      },
      { root, threshold: [0.1, 0.5, 0.9] },
    );
    pageNodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [compact, numPages, baseWidth, zoom]);

  const changeZoom = useCallback(
    (delta: number) =>
      setZoom((value) =>
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((value + delta) * 100) / 100)),
      ),
    [],
  );

  const registerPage = useCallback(
    (pageNumber: number) => (node: HTMLDivElement | null) => {
      if (node) pageNodes.current.set(pageNumber, node);
      else pageNodes.current.delete(pageNumber);
    },
    [],
  );

  const pageWidth = Math.round(baseWidth * zoom);

  return (
    <div className="flex h-full w-full flex-col bg-charcoal-card">
      {compact ? null : (
        <div className="flex h-11 flex-none items-center justify-between gap-3 border-b border-charcoal-border bg-charcoal-bg px-3 text-cream ">
          <span className="min-w-0 truncate text-sm font-medium" title={name}>
            {name}
          </span>
          <div className="flex flex-none items-center gap-3">
            <span className="text-xs tabular-nums text-cream-muted">
              {numPages ? `Page ${currentPage} of ${numPages}` : "—"}
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Zoom out"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => changeZoom(-ZOOM_STEP)}
              >
                <Minus size={16} />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-cream-muted">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Zoom in"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => changeZoom(ZOOM_STEP)}
              >
                <Plus size={16} />
              </Button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className={
          compact
            ? "flex min-h-0 flex-1 flex-col items-center overflow-auto p-2"
            : "flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-6"
        }
        aria-label={`PDF reader for ${name}`}
      >
        {loadError ? (
          <p className="mt-10 max-w-sm text-center text-sm text-cream-bright">{loadError}</p>
        ) : (
          <Document
            file={url}
            onLoadSuccess={(pdf) => {
              setLoadError("");
              setNumPages(pdf.numPages);
            }}
            onLoadError={(error) =>
              setLoadError(error instanceof Error ? error.message : "This PDF could not be opened.")
            }
            loading={
              <div className="mt-10 grid justify-items-center gap-2 text-sm text-cream-muted">
                <Loader2 className="animate-spin" size={26} />
                Loading PDF…
              </div>
            }
          >
            {pageWidth <= 0
              ? null
              : compact
                ? numPages > 0 && (
                    <Page
                      pageNumber={1}
                      width={pageWidth}
                      className="overflow-hidden rounded-md shadow-lg"
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  )
                : Array.from({ length: numPages }, (_, index) => (
                    <div key={index} ref={registerPage(index + 1)} data-page={index + 1}>
                      <Page
                        pageNumber={index + 1}
                        width={pageWidth}
                        className="mb-4 overflow-hidden rounded-md shadow-lg"
                        renderTextLayer
                        renderAnnotationLayer
                      />
                    </div>
                  ))}
          </Document>
        )}
      </div>
    </div>
  );
}
