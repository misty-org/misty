import type { PreviewErrorComponent } from "./preview_types";
import { IconButton, SetupState, Surface, Text } from "@misty/ui";
import { Minus, Plus } from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { uiPx } from "@misty/ui";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PAGE_WIDTH = 900;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;

export default function PdfViewerView({
  Error,
  url,
  name,
  compact = false,
}: {
  Error: PreviewErrorComponent;
  url: string;
  name: string;
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
      setBaseWidth(Math.min(element.clientWidth - uiPx(compact ? 16 : 48), uiPx(MAX_PAGE_WIDTH)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

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
    <Surface tone="card" className="flex h-full w-full flex-col">
      {compact ? null : (
        <Surface
          tone="page"
          className="flex h-12 flex-none items-center justify-between gap-3 border-b px-3"
        >
          <Text full size="control" weight="medium" tone="default">
            {name}
          </Text>
          <div className="flex flex-none items-center gap-3">
            <Text bare size="meta" tone="muted" className="tabular-nums">
              {numPages ? `Page ${currentPage} of ${numPages}` : "—"}
            </Text>
            <div className="flex items-center gap-0.5">
              <IconButton
                label="Zoom out"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => changeZoom(-ZOOM_STEP)}
              >
                <Minus />
              </IconButton>
              <Text bare size="meta" tone="muted" className="w-12 text-center tabular-nums">
                {Math.round(zoom * 100)}%
              </Text>
              <IconButton
                label="Zoom in"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => changeZoom(ZOOM_STEP)}
              >
                <Plus />
              </IconButton>
            </div>
          </div>
        </Surface>
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
          <Error error={loadError} scope="files:pdf-viewer" title="PDF could not be opened" />
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
            loading={<SetupState tool="PDF viewer" size="inline" />}
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
    </Surface>
  );
}
